package expo.modules.lenscamera.imaging

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.util.Log
import androidx.exifinterface.media.ExifInterface
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.segmentation.Segmentation
import com.google.mlkit.vision.segmentation.selfie.SelfieSegmenterOptions
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.TimeUnit
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Portrait on Android: the person is found by ML Kit's selfie segmentation
 * (bundled model, runs on the phone, no Google Play services needed), and the
 * mask is stored inside the photo (see [JpegMask]). The background blur is an
 * edit (recipe `portrait.aperture`), adjustable or removable later, like iOS.
 */
object Portrait {
  private const val TAG = "LensPortrait"
  /** Stored mask size (long side). 768 px keeps refined hair edges and fits the 64 KB JPEG segment (~20–30 KB). */
  private const val MASK_PX = 768

  private val segmenter by lazy {
    Segmentation.getClient(
      SelfieSegmenterOptions.Builder()
        .setDetectorMode(SelfieSegmenterOptions.SINGLE_IMAGE_MODE)
        .build(),
    )
  }

  /** Old-style sidecar (kept for compatibility). */
  private fun sidecar(photo: File) = File(photo.path + ".mask.png")

  fun hasMask(photo: File) = JpegMask.extract(photo) != null || sidecar(photo).exists()

  /** Mask as a GL texture (call on the imaging thread), or null. */
  fun maskTexture(photo: File): Int? {
    val bitmap = JpegMask.extract(photo)?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
      ?: sidecar(photo).takeIf { it.exists() }?.let { BitmapFactory.decodeFile(it.path) }
      ?: return null
    return ImagingEngine.bitmapTexture(bitmap).also { bitmap.recycle() }
  }

  /**
   * Finds the person in [photo] (a JPEG just taken) and embeds the mask.
   * Returns false when nobody was found (the photo is left as it was).
   * Runs on a background thread; takes ~100–300 ms.
   */
  /** Coverage (0…1) of the person in the last [addMask] photo, for the automatic blur strength. */
  @Volatile var lastCoverage = 0.0
    private set
  /** What the last [addMask] separated: "person" (selfie model) or "subject" (pets/objects, Play services). */
  @Volatile var lastKind = "person"
    private set

  private val subjectSegmenter by lazy {
    com.google.mlkit.vision.segmentation.subject.SubjectSegmentation.getClient(
      com.google.mlkit.vision.segmentation.subject.SubjectSegmenterOptions.Builder().enableForegroundConfidenceMask().build(),
    )
  }

  /**
   * No person found: any main subject (pet, object) from ML Kit subject segmentation,
   * as a mask the size of [upright], or null (no Play services, model not ready, nothing found).
   * Beta API: every failure just means "no subject".
   */
  private fun subjectMask(upright: Bitmap): Bitmap? = try {
    val result = Tasks.await(subjectSegmenter.process(InputImage.fromBitmap(upright, 0)), 10, TimeUnit.SECONDS)
    val conf = result.foregroundConfidenceMask
    val n = upright.width * upright.height
    if (conf == null || conf.capacity() < n) null else {
      conf.rewind()
      var fg = 0
      val pixels = IntArray(n) {
        val v = (conf.get().coerceIn(0f, 1f) * 255).roundToInt()
        if (v > 128) fg++
        (0xFF shl 24) or (v shl 16) or (v shl 8) or v
      }
      // A subject has to be a real part of the frame (not a speck, not everything).
      val share = fg.toDouble() / n
      if (share < 0.02 || share > 0.9) null else {
        lastCoverage = share
        Bitmap.createBitmap(pixels, upright.width, upright.height, Bitmap.Config.ARGB_8888)
      }
    }
  } catch (e: Exception) {
    Log.i(TAG, "subject segmentation unavailable: ${e.message}")
    null
  }

  fun addMask(photo: File): Boolean {
    try {
      val orientation = ExifInterface(photo).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(photo.path, bounds)
      var sample = 1
      while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 640) sample *= 2
      val stored = BitmapFactory.decodeFile(photo.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return false
      // Segment upright (the model expects people the right way up)…
      val toUpright = exifMatrix(orientation)
      val upright = Bitmap.createBitmap(stored, 0, 0, stored.width, stored.height, toUpright, true)
      val mask = Tasks.await(segmenter.process(InputImage.fromBitmap(upright, 0)), 10, TimeUnit.SECONDS)
      val mw = mask.width
      val mh = mask.height
      val buffer = mask.buffer
      buffer.rewind()
      val pixels = IntArray(mw * mh)
      var subject = 0
      for (i in 0 until mw * mh) {
        val v = (buffer.float.coerceIn(0f, 1f) * 255).roundToInt()
        if (v > 128) subject++
        pixels[i] = (0xFF shl 24) or (v shl 16) or (v shl 8) or v
      }
      // Nobody (or almost nobody) in the frame: try any main subject (pet, object) before giving up.
      lastCoverage = subject.toDouble() / (mw * mh)
      lastKind = "person"
      val coarse = if (subject >= mw * mh * 0.02) {
        Bitmap.createBitmap(pixels, mw, mh, Bitmap.Config.ARGB_8888)
      } else {
        subjectMask(upright)?.also { lastKind = "subject" } ?: return false
      }
      // Refinement only sharpens the edges: if it fails, the coarse mask still makes the portrait.
      var maskBitmap = runCatching { refine(upright, coarse) }
        .onFailure { Log.w(TAG, "edge refinement failed, using the coarse mask", it) }
        .getOrElse { Bitmap.createScaledBitmap(coarse, upright.width, upright.height, true) }
      // …then store it in the photo's stored orientation (that's how the renderer samples it).
      val inverse = Matrix().also { toUpright.invert(it) }
      maskBitmap = Bitmap.createBitmap(maskBitmap, 0, 0, maskBitmap.width, maskBitmap.height, inverse, true)
      val scale = MASK_PX.toFloat() / max(maskBitmap.width, maskBitmap.height)
      if (scale < 1f) {
        maskBitmap = Bitmap.createScaledBitmap(maskBitmap, (maskBitmap.width * scale).roundToInt(), (maskBitmap.height * scale).roundToInt(), true)
      }
      var png = encode(maskBitmap)
      if (png.size > JpegMask.MAX_MASK_BYTES) {
        png = encode(Bitmap.createScaledBitmap(maskBitmap, maskBitmap.width / 2, maskBitmap.height / 2, true))
      }
      if (png.size > JpegMask.MAX_MASK_BYTES) return false
      val tmp = File(photo.path + ".tmp")
      tmp.writeBytes(JpegMask.embed(photo.readBytes(), png))
      return tmp.renameTo(photo)
    } catch (e: Exception) {
      Log.w(TAG, "segmentation failed", e)
      return false
    }
  }

  /**
   * Edge refinement (checklist 4.3, measured on real S8 portraits in
   * docs/research/portrait.md): the model's coarse mask snapped to the photo's own
   * edges with a guided filter (He et al.), only within a thin band around the
   * coarse edge (a trimap), so hair outlines follow the hair without leaking into
   * a similar-looking background. Works at the photo copy's size (~640–1280 px).
   */
  internal fun refine(photo: Bitmap, coarse: Bitmap): Bitmap {
    val w = photo.width
    val h = photo.height
    val n = w * h
    val px = IntArray(n).also { photo.getPixels(it, 0, w, 0, 0, w, h) }
    val guide = FloatArray(n) { i ->
      val c = px[i]
      (0.299f * ((c shr 16) and 0xFF) + 0.587f * ((c shr 8) and 0xFF) + 0.114f * (c and 0xFF)) / 255f
    }
    val up = Bitmap.createScaledBitmap(coarse, w, h, true)
    val mp = IntArray(n).also { up.getPixels(it, 0, w, 0, 0, w, h) }
    up.recycle()
    val p = FloatArray(n) { (mp[it] and 0xFF) / 255f }
    val refined = guidedFilter(guide, p, w, h, radius = (0.006f * max(w, h)).roundToInt() + 2, eps = 1e-3f)
    // Trimap band: within ~1.5 % of the long side of the coarse edge use the refined value, fading to coarse outside.
    val band = 0.015f * max(w, h)
    val dist = edgeDistance(p, w, h, band)
    val out = IntArray(n)
    var bad = 0
    var firstBad: String? = null
    for (i in 0 until n) {
      val t = (1f - dist[i] / band).coerceIn(0f, 1f)
      // coerceIn lets NaN through: a pixel the filter couldn't solve keeps the coarse value
      // (seen on the Galaxy S8, 2026-10-19: "Cannot round NaN value" dropped the whole mask).
      var mixed = refined[i] * t + p[i] * (1f - t)
      if (!mixed.isFinite()) {
        if (bad == 0) firstBad = "i=$i refined=${refined[i]} p=${p[i]} dist=${dist[i]} band=$band t=$t mixed=$mixed"
        bad++
        mixed = p[i]
      }
      val v = (mixed.coerceIn(0f, 1f) * 255).roundToInt()
      out[i] = (0xFF shl 24) or (v shl 16) or (v shl 8) or v
    }
    if (bad > 0) {
      Log.w(TAG, "refine: $bad of $n pixels not finite (${w}x$h, guide ${guide.count { !it.isFinite() }}, " +
        "refined ${refined.count { !it.isFinite() }}, dist ${dist.count { !it.isFinite() }}; first: $firstBad)")
    }
    return Bitmap.createBitmap(out, w, h, Bitmap.Config.ARGB_8888)
  }

  /** Guided filter with box means from integral images (O(n) whatever the radius). */
  internal fun guidedFilter(i: FloatArray, p: FloatArray, w: Int, h: Int, radius: Int, eps: Float): FloatArray {
    val n = w * h
    val mI = boxMean(i, w, h, radius)
    val mP = boxMean(p, w, h, radius)
    val mIp = boxMean(FloatArray(n) { i[it] * p[it] }, w, h, radius)
    val mII = boxMean(FloatArray(n) { i[it] * i[it] }, w, h, radius)
    val a = FloatArray(n)
    val b = FloatArray(n)
    for (k in 0 until n) {
      val cov = mIp[k] - mI[k] * mP[k]
      val variance = mII[k] - mI[k] * mI[k]
      a[k] = cov / (variance + eps)
      b[k] = mP[k] - a[k] * mI[k]
    }
    val mA = boxMean(a, w, h, radius)
    val mB = boxMean(b, w, h, radius)
    return FloatArray(n) { (mA[it] * i[it] + mB[it]).coerceIn(0f, 1f) }
  }

  private fun boxMean(x: FloatArray, w: Int, h: Int, r: Int): FloatArray {
    // Integral image with a zero row/column; doubles keep precision on 1 MP images.
    val iw = w + 1
    val sum = DoubleArray(iw * (h + 1))
    for (y in 0 until h) {
      var row = 0.0
      for (xx in 0 until w) {
        row += x[y * w + xx]
        sum[(y + 1) * iw + xx + 1] = sum[y * iw + xx + 1] + row
      }
    }
    val out = FloatArray(w * h)
    for (y in 0 until h) {
      val y0 = maxOf(0, y - r)
      val y1 = minOf(h, y + r + 1)
      for (xx in 0 until w) {
        val x0 = maxOf(0, xx - r)
        val x1 = minOf(w, xx + r + 1)
        val s = sum[y1 * iw + x1] - sum[y0 * iw + x1] - sum[y1 * iw + x0] + sum[y0 * iw + x0]
        out[y * w + xx] = (s / ((y1 - y0) * (x1 - x0))).toFloat()
      }
    }
    return out
  }

  /** Approximate distance (px) to the coarse mask's 0.5 edge, capped at [cap] (two-pass chamfer). */
  private fun edgeDistance(m: FloatArray, w: Int, h: Int, cap: Float): FloatArray {
    val inside = BooleanArray(w * h) { m[it] > 0.5f }
    val d = FloatArray(w * h) { cap }
    for (y in 0 until h) for (x in 0 until w) {
      val k = y * w + x
      if ((x > 0 && inside[k - 1] != inside[k]) || (y > 0 && inside[k - w] != inside[k])) d[k] = 0f
    }
    for (y in 0 until h) for (x in 0 until w) {
      val k = y * w + x
      if (x > 0) d[k] = minOf(d[k], d[k - 1] + 1f)
      if (y > 0) d[k] = minOf(d[k], d[k - w] + 1f)
    }
    for (y in h - 1 downTo 0) for (x in w - 1 downTo 0) {
      val k = y * w + x
      if (x < w - 1) d[k] = minOf(d[k], d[k + 1] + 1f)
      if (y < h - 1) d[k] = minOf(d[k], d[k + w] + 1f)
    }
    return d
  }

  private fun encode(bitmap: Bitmap): ByteArray =
    ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()

  private fun exifMatrix(orientation: Int) = Matrix().apply {
    when (orientation) {
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> postScale(-1f, 1f)
      ExifInterface.ORIENTATION_ROTATE_180 -> postRotate(180f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> postScale(1f, -1f)
      ExifInterface.ORIENTATION_TRANSPOSE -> {
        postRotate(90f)
        postScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_ROTATE_90 -> postRotate(90f)
      ExifInterface.ORIENTATION_TRANSVERSE -> {
        postRotate(-90f)
        postScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_ROTATE_270 -> postRotate(-90f)
    }
  }
}
