package expo.modules.lenscamera.imaging

import android.app.ActivityManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapRegionDecoder
import android.graphics.Canvas
import android.graphics.ImageDecoder
import android.graphics.Rect
import android.net.Uri
import android.opengl.EGL14
import android.opengl.EGLSurface
import android.opengl.GLES20
import android.opengl.GLUtils
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import androidx.exifinterface.media.ExifInterface
import expo.modules.lenscamera.LookLut
import expo.modules.lenscamera.LookStore
import expo.modules.lenscamera.gl.EglCore
import expo.modules.lenscamera.gl.GlUtil
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutionException
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

class ImagingException(message: String) : Exception(message)

/**
 * On-device photo rendering: looks, adjustments, crop and portrait blur.
 *
 * One background thread owns an OpenGL ES 2.0 context. Photos are decoded
 * region by region (BitmapRegionDecoder) and rendered in tiles of at most
 * 1024 px, so a 50–200 MP photo never needs one giant texture; only the output
 * bitmap is held whole, and its size is capped by the memory this phone has.
 */
object ImagingEngine {
  private val thread = HandlerThread("LensImaging").apply { start() }
  val handler = Handler(thread.looper)

  private var egl: EglCore? = null
  private var pbuffer: EGLSurface = EGL14.EGL_NO_SURFACE
  private var renderer: EditRenderer? = null
  private var maxTexture = 2048
  private val lutTextures = HashMap<String, Int>()

  /** Runs [block] on the imaging thread with the GL context current. */
  fun <T> run(block: () -> T): T {
    val future = CompletableFuture<T>()
    handler.post {
      try {
        ensureGl()
        future.complete(block())
      } catch (e: Throwable) {
        future.completeExceptionally(e)
      }
    }
    try {
      return future.get()
    } catch (e: ExecutionException) {
      throw e.cause ?: e
    }
  }

  /** For callers already on the imaging thread. */
  fun ensureGl(): EditRenderer {
    renderer?.let { return it }
    val core = EglCore()
    egl = core
    pbuffer = core.pbuffer()
    core.makeCurrent(pbuffer)
    val size = IntArray(1)
    GLES20.glGetIntegerv(GLES20.GL_MAX_TEXTURE_SIZE, size, 0)
    maxTexture = max(2048, size[0])
    return EditRenderer().also { renderer = it }
  }

  val eglCore get() = egl
  fun makeOffscreenCurrent() = egl?.makeCurrent(pbuffer)
  val tileSize get() = min(1024, maxTexture / 2)

  fun lutTexture(context: Context, id: String?): Int {
    if (id == null) return 0
    lutTextures[id]?.let { return it }
    val strip = LookStore.strip(context, id) ?: return 0
    val n = LookLut.SIZE
    val buffer = ByteBuffer.allocateDirect(strip.size).order(ByteOrder.nativeOrder()).put(strip)
    buffer.position(0)
    return GlUtil.texture2d(n * n, n, buffer).also { lutTextures[id] = it }
  }

  // ---------- Decoding ----------

  /** A photo file: stored size, EXIF orientation, and how to read pixels from it. */
  class Source(val file: File) {
    val orientation: Int = runCatching {
      ExifInterface(file).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
    }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
    val width: Int
    val height: Int
    private var regionDecoder: BitmapRegionDecoder? = null
    /** Fallback when region decoding isn't supported (e.g. DNG): one downsampled decode. */
    private var whole: Bitmap? = null
    private var wholeSample = 1

    init {
      val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(file.path, opts)
      var w = opts.outWidth
      var h = opts.outHeight
      if ((w <= 0 || h <= 0) && Build.VERSION.SDK_INT >= 28) {
        // Formats BitmapFactory can't size (some HEIF/RAW variants).
        ImageDecoder.decodeDrawable(ImageDecoder.createSource(file)) { decoder, info, _ ->
          w = info.size.width
          h = info.size.height
          decoder.setTargetSize(1, 1)
        }
      }
      if (w <= 0 || h <= 0) throw ImagingException("This photo's format can't be opened on this phone.")
      width = w
      height = h
      regionDecoder = runCatching {
        @Suppress("DEPRECATION")
        if (Build.VERSION.SDK_INT >= 31) BitmapRegionDecoder.newInstance(file.path) else BitmapRegionDecoder.newInstance(file.path, false)
      }.getOrNull()
    }

    /** Decodes a downsampled copy whose longest side is about [longest] px. */
    fun small(longest: Int): Bitmap {
      var sample = 1
      while (max(width, height) / (sample * 2) >= longest) sample *= 2
      return decodeWhole(sample) ?: throw ImagingException("Could not read the photo")
    }

    private fun decodeWhole(sample: Int): Bitmap? {
      val opts = BitmapFactory.Options().apply {
        inSampleSize = sample
        inPreferredConfig = Bitmap.Config.ARGB_8888
      }
      BitmapFactory.decodeFile(file.path, opts)?.let { return it }
      if (Build.VERSION.SDK_INT >= 28) {
        return runCatching {
          ImageDecoder.decodeBitmap(ImageDecoder.createSource(file)) { decoder, info, _ ->
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            decoder.setTargetSize(max(1, info.size.width / sample), max(1, info.size.height / sample))
          }
        }.getOrNull()
      }
      return null
    }

    /** Pixels of [rect] (stored pixels), downsampled by [sample] (power of two). */
    fun region(rect: Rect, sample: Int): Bitmap {
      regionDecoder?.let { d ->
        val opts = BitmapFactory.Options().apply {
          inSampleSize = sample
          inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        d.decodeRegion(rect, opts)?.let { return it }
      }
      // No region decoder: crop from a whole decode (kept for the next tile).
      val bitmap = whole?.takeIf { wholeSample <= sample } ?: decodeWhole(sample).also {
        whole?.recycle()
        whole = it
        wholeSample = sample
      } ?: throw ImagingException("Could not read the photo")
      val sx = bitmap.width.toDouble() / width
      val sy = bitmap.height.toDouble() / height
      val r = Rect(
        floor(rect.left * sx).toInt().coerceIn(0, bitmap.width - 1),
        floor(rect.top * sy).toInt().coerceIn(0, bitmap.height - 1),
        ceil(rect.right * sx).toInt().coerceIn(1, bitmap.width),
        ceil(rect.bottom * sy).toInt().coerceIn(1, bitmap.height),
      )
      val cut = Bitmap.createBitmap(bitmap, r.left, r.top, max(1, r.width()), max(1, r.height()))
      // createBitmap may return the same object for the full area; the caller recycles it.
      return if (cut === bitmap) bitmap.copy(Bitmap.Config.ARGB_8888, false) else cut
    }

    fun close() {
      regionDecoder?.recycle()
      whole?.recycle()
    }
  }

  fun fileOf(uri: String): File {
    val path = if (uri.startsWith("file:")) Uri.parse(uri).path else uri
    val file = File(path ?: uri)
    if (!file.exists()) throw ImagingException("File not found")
    return file
  }

  /** Small analysis of the whole image: auto-enhance values + base texture. */
  class Analysis(val auto: Tone.Auto, val base: Int)

  fun analyse(source: Source): Analysis {
    val small = source.small(256)
    val sw = min(small.width, 192)
    val sh = max(1, (small.height * sw.toDouble() / small.width).roundToInt())
    val scaled = if (small.width != sw) Bitmap.createScaledBitmap(small, sw, sh, true) else small
    val pixels = IntArray(scaled.width * scaled.height)
    scaled.getPixels(pixels, 0, scaled.width, 0, 0, scaled.width, scaled.height)
    val auto = Tone.auto(pixels)
    val base = Tone.base(pixels, scaled.width, scaled.height)
    val texture = luminanceTexture(scaled.width, scaled.height, base)
    if (scaled !== small) scaled.recycle()
    small.recycle()
    return Analysis(auto, texture)
  }

  fun luminanceTexture(w: Int, h: Int, bytes: ByteArray): Int {
    val t = IntArray(1)
    GLES20.glGenTextures(1, t, 0)
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, t[0])
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
    GLES20.glPixelStorei(GLES20.GL_UNPACK_ALIGNMENT, 1)
    val buffer = ByteBuffer.allocateDirect(bytes.size).put(bytes)
    buffer.position(0)
    GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_LUMINANCE, w, h, 0, GLES20.GL_LUMINANCE, GLES20.GL_UNSIGNED_BYTE, buffer)
    GLES20.glPixelStorei(GLES20.GL_UNPACK_ALIGNMENT, 4)
    return t[0]
  }

  fun bitmapTexture(bitmap: Bitmap): Int {
    val t = IntArray(1)
    GLES20.glGenTextures(1, t, 0)
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, t[0])
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
    GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bitmap, 0)
    return t[0]
  }

  fun deleteTexture(t: Int) {
    if (t != 0) GLES20.glDeleteTextures(1, intArrayOf(t), 0)
  }

  // ---------- Rendering ----------

  data class Rendered(val file: File, val width: Int, val height: Int)

  /**
   * Renders [uri] with [recipe] to a new JPEG. [maxPixel] (longest side) for
   * previews; null = full resolution (limited only by this phone's memory).
   */
  fun render(context: Context, uri: String, recipe: EditRecipe?, maxPixel: Int?, quality: Double): Rendered = run {
    val r = ensureGl()
    val source = Source(fileOf(uri))
    val textures = mutableListOf<Int>()
    try {
      val geometry = Geometry(source.width, source.height, source.orientation, recipe?.crop)
      var scale = 1.0
      if (maxPixel != null && maxPixel > 0) scale = min(1.0, maxPixel.toDouble() / max(geometry.outputWidth, geometry.outputHeight))
      // Cap the output bitmap by available memory (a 200 MP export on a 3 GB phone).
      val budget = memoryBudget(context)
      val bytes = geometry.outputWidth * scale * geometry.outputHeight * scale * 4
      if (bytes > budget) scale *= kotlin.math.sqrt(budget / bytes)
      val outW = max(1, (geometry.outputWidth * scale).roundToInt())
      val outH = max(1, (geometry.outputHeight * scale).roundToInt())

      val analysis = analyse(source)
      textures += analysis.base
      val mask = if (recipe?.aperture != null) Portrait.maskTexture(source.file)?.also { textures += it } ?: 0 else 0
      val lut = lutTexture(context, recipe?.look)

      val output = Bitmap.createBitmap(outW, outH, Bitmap.Config.ARGB_8888)
      val canvas = Canvas(output)
      val tile = tileSize
      val (fbTex, fb) = GlUtil.framebuffer(tile, tile)
      textures += fbTex
      val pixels = ByteBuffer.allocateDirect(tile * tile * 4).order(ByteOrder.nativeOrder())
      val tileBitmap = Bitmap.createBitmap(tile, tile, Bitmap.Config.ARGB_8888)
      // Stored pixels per output pixel -> how much the decoder may downsample.
      val density = geometry.sourcePixelsPerOutputPixel(source.width, source.height) / scale
      var sample = 1
      while (sample * 2 <= density) sample *= 2
      // Neighbours read by sharpening/portrait blur must exist at tile edges.
      val margin = (if (recipe?.aperture != null) 48 else 4) * sample

      GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fb)
      var ty = 0
      while (ty < outH) {
        val th = min(tile, outH - ty)
        var tx = 0
        while (tx < outW) {
          val tw = min(tile, outW - tx)
          val b = geometry.sourceBounds(tx / outW.toDouble(), ty / outH.toDouble(), (tx + tw) / outW.toDouble(), (ty + th) / outH.toDouble())
          val rect = Rect(
            max(0, floor(b[0] * source.width).toInt() - margin),
            max(0, floor(b[1] * source.height).toInt() - margin),
            min(source.width, ceil(b[2] * source.width).toInt() + margin),
            min(source.height, ceil(b[3] * source.height).toInt() + margin),
          )
          if (rect.width() < 1) rect.right = min(source.width, rect.left + 1)
          if (rect.height() < 1) rect.bottom = min(source.height, rect.top + 1)
          val region = source.region(rect, sample)
          val tex = bitmapTexture(region)
          val inputs = EditRenderer.Inputs(
            source = tex,
            region = floatArrayOf(
              rect.left / source.width.toFloat(),
              rect.top / source.height.toFloat(),
              rect.width() / source.width.toFloat(),
              rect.height() / source.height.toFloat(),
            ),
            sourceWidth = region.width,
            sourceHeight = region.height,
            base = analysis.base,
            mask = mask,
            lut = lut,
            geometry = geometry.matrix,
            outputWidth = outW,
            outputHeight = outH,
          )
          GLES20.glViewport(0, 0, tw, th)
          r.draw(recipe, analysis.auto, inputs, tx, ty, tw, th)
          pixels.position(0)
          GLES20.glReadPixels(0, 0, tile, tile, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, pixels)
          pixels.position(0)
          tileBitmap.copyPixelsFromBuffer(pixels)
          canvas.drawBitmap(tileBitmap, Rect(0, 0, tw, th), Rect(tx, ty, tx + tw, ty + th), null)
          deleteTexture(tex)
          region.recycle()
          tx += tile
        }
        ty += tile
      }
      GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
      GLES20.glDeleteFramebuffers(1, intArrayOf(fb), 0)
      tileBitmap.recycle()

      val target = File(context.cacheDir, "lens-render-${UUID.randomUUID()}.jpg")
      FileOutputStream(target).use { output.compress(Bitmap.CompressFormat.JPEG, (quality * 100).roundToInt().coerceIn(1, 100), it) }
      output.recycle()
      copyExif(source.file, target, outW, outH)
      Rendered(target, outW, outH)
    } finally {
      textures.forEach { deleteTexture(it) }
      source.close()
    }
  }

  private fun memoryBudget(context: Context): Double {
    val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val info = ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
    // Android 8+ keeps bitmaps in native memory; older versions in the Java heap.
    val limit = if (Build.VERSION.SDK_INT >= 26) info.availMem / 3.0 else Runtime.getRuntime().maxMemory() / 3.0
    return limit.coerceIn(48e6, 600e6)
  }

  /** Keeps capture metadata (date, place, camera settings); the pixels are now upright. */
  private fun copyExif(from: File, to: File, width: Int, height: Int) {
    runCatching {
      val src = ExifInterface(from)
      val dst = ExifInterface(to)
      for (tag in EXIF_TAGS) src.getAttribute(tag)?.let { dst.setAttribute(tag, it) }
      dst.setAttribute(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL.toString())
      dst.setAttribute(ExifInterface.TAG_PIXEL_X_DIMENSION, width.toString())
      dst.setAttribute(ExifInterface.TAG_PIXEL_Y_DIMENSION, height.toString())
      dst.saveAttributes()
    }
  }

  private val EXIF_TAGS = listOf(
    ExifInterface.TAG_DATETIME,
    ExifInterface.TAG_DATETIME_ORIGINAL,
    ExifInterface.TAG_DATETIME_DIGITIZED,
    ExifInterface.TAG_OFFSET_TIME,
    ExifInterface.TAG_OFFSET_TIME_ORIGINAL,
    ExifInterface.TAG_SUBSEC_TIME_ORIGINAL,
    ExifInterface.TAG_MAKE,
    ExifInterface.TAG_MODEL,
    ExifInterface.TAG_EXPOSURE_TIME,
    ExifInterface.TAG_F_NUMBER,
    ExifInterface.TAG_PHOTOGRAPHIC_SENSITIVITY,
    ExifInterface.TAG_FOCAL_LENGTH,
    ExifInterface.TAG_FOCAL_LENGTH_IN_35MM_FILM,
    ExifInterface.TAG_FLASH,
    ExifInterface.TAG_WHITE_BALANCE,
    ExifInterface.TAG_GPS_LATITUDE,
    ExifInterface.TAG_GPS_LATITUDE_REF,
    ExifInterface.TAG_GPS_LONGITUDE,
    ExifInterface.TAG_GPS_LONGITUDE_REF,
    ExifInterface.TAG_GPS_ALTITUDE,
    ExifInterface.TAG_GPS_ALTITUDE_REF,
    ExifInterface.TAG_GPS_TIMESTAMP,
    ExifInterface.TAG_GPS_DATESTAMP,
  )
}
