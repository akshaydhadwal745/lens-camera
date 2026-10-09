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
  private const val MASK_PX = 384

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
      // Nobody (or almost nobody) in the frame: no portrait effect.
      if (subject < mw * mh * 0.02) return false
      var maskBitmap = Bitmap.createBitmap(pixels, mw, mh, Bitmap.Config.ARGB_8888)
      // …then store it in the photo's stored orientation (that's how the renderer samples it).
      val inverse = Matrix().also { toUpright.invert(it) }
      maskBitmap = Bitmap.createBitmap(maskBitmap, 0, 0, mw, mh, inverse, true)
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
