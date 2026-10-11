package expo.modules.lenscamera.gl

import android.graphics.Bitmap
import android.util.Log
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.segmentation.Segmentation
import com.google.mlkit.vision.segmentation.Segmenter
import com.google.mlkit.vision.segmentation.selfie.SelfieSegmenterOptions
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors
import kotlin.math.roundToInt

/**
 * Portrait in the viewfinder: finds the person in small copies of the preview
 * (about 320 px, a few times a second) with the same bundled ML Kit model the
 * photo uses, in its video mode. The result is a mask the preview shader uses
 * to blur the background, so what you see matches the saved photo.
 *
 * Frames come in as RGBA rows straight from glReadPixels (bottom row first);
 * the mask goes out top row first, one byte per pixel (255 = person).
 */
class LivePortrait {
  /** A new mask (on the segmentation thread). `subject`: a person was found. */
  var onMask: ((mask: ByteBuffer, width: Int, height: Int, subject: Boolean) -> Unit)? = null

  @Volatile var busy = false
    private set

  private val executor = Executors.newSingleThreadExecutor { Thread(it, "LensLivePortrait") }
  private var segmenter: Segmenter? = null
  private var previous: FloatArray? = null
  private var closed = false

  /** [rgba]: glReadPixels output (bottom-up). Ignored while the last frame is still being processed. */
  fun submit(rgba: ByteArray, width: Int, height: Int) {
    if (busy || closed) return
    busy = true
    executor.execute {
      try {
        process(rgba, width, height)
      } catch (e: Exception) {
        Log.w(TAG, "live segmentation failed", e)
      } finally {
        busy = false
      }
    }
  }

  /** Forget the last mask (camera or mode changed), so an old person doesn't linger. */
  fun reset() {
    executor.execute { previous = null }
  }

  fun close() {
    closed = true
    executor.execute {
      segmenter?.close()
      segmenter = null
    }
    executor.shutdown()
  }

  private fun process(rgba: ByteArray, width: Int, height: Int) {
    // Upright for the model: flip rows (GL reads bottom-up).
    val pixels = IntArray(width * height)
    for (y in 0 until height) {
      val src = (height - 1 - y) * width * 4
      val dst = y * width
      for (x in 0 until width) {
        val i = src + x * 4
        pixels[dst + x] = (0xFF shl 24) or
          ((rgba[i].toInt() and 0xFF) shl 16) or
          ((rgba[i + 1].toInt() and 0xFF) shl 8) or
          (rgba[i + 2].toInt() and 0xFF)
      }
    }
    val bitmap = Bitmap.createBitmap(pixels, width, height, Bitmap.Config.ARGB_8888)
    val client = segmenter ?: Segmentation.getClient(
      SelfieSegmenterOptions.Builder().setDetectorMode(SelfieSegmenterOptions.STREAM_MODE).build(),
    ).also { segmenter = it }
    val result = com.google.android.gms.tasks.Tasks.await(client.process(InputImage.fromBitmap(bitmap, 0)))
    bitmap.recycle()

    val mw = result.width
    val mh = result.height
    val buffer = result.buffer
    buffer.rewind()
    val confidence = FloatArray(mw * mh) { buffer.float.coerceIn(0f, 1f) }
    // Light temporal smoothing: less shimmer at the edges between masks.
    val last = previous
    if (last != null && last.size == confidence.size) {
      for (i in confidence.indices) confidence[i] = confidence[i] * 0.6f + last[i] * 0.4f
    }
    previous = confidence

    val out = ByteBuffer.allocateDirect(mw * mh).order(ByteOrder.nativeOrder())
    var subject = 0
    for (v in confidence) {
      if (v > 0.5f) subject++
      out.put((v * 255).roundToInt().toByte())
    }
    out.position(0)
    // Same rule as the photo (Portrait.addMask): almost nobody in frame = no effect.
    onMask?.invoke(out, mw, mh, subject >= mw * mh * 0.02)
  }

  companion object {
    private const val TAG = "LensPreview"

    /** Background blur as a fraction of the frame's long side: the same as the saved photo's disc. */
    fun blurFraction(aperture: Double): Float = expo.modules.lenscamera.imaging.PortraitStyle.blurFraction(aperture)
  }
}
