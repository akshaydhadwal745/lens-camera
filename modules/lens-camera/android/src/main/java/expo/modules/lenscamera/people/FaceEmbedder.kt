package expo.modules.lenscamera.people

import android.content.Context
import android.graphics.Bitmap
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.tflite.java.TfLite
import org.tensorflow.lite.InterpreterApi
import java.io.Closeable
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.TimeUnit

/**
 * People: SFace (OpenCV Zoo, Apache 2.0) on LiteRT from Google Play services, so
 * the runtime adds nothing to the APK (docs/design/people.md). The model file is
 * downloaded only when People is turned on. Off the main thread only (it waits).
 *
 * Input: an aligned 112x112 face (FaceAlign), RGB 0..255 floats, no mean/scale —
 * the same preprocessing as OpenCV's FaceRecognizerSF (research/faces/convert.py).
 * Output: a unit-length 128-d embedding.
 */
class FaceEmbedder private constructor(private val interpreter: InterpreterApi) : Closeable {
  private val input = ByteBuffer.allocateDirect(SIZE * SIZE * 3 * 4).order(ByteOrder.nativeOrder())
  private val output = Array(1) { FloatArray(DIM) }
  private val pixels = IntArray(SIZE * SIZE)

  fun embed(face: Bitmap): FloatArray {
    require(face.width == SIZE && face.height == SIZE) { "face must be ${SIZE}x$SIZE" }
    face.getPixels(pixels, 0, SIZE, 0, 0, SIZE, SIZE)
    input.rewind()
    for (p in pixels) {
      input.putFloat(((p shr 16) and 0xff).toFloat())
      input.putFloat(((p shr 8) and 0xff).toFloat())
      input.putFloat((p and 0xff).toFloat())
    }
    input.rewind()
    interpreter.run(input, output)
    return FaceAlign.normalize(output[0].copyOf())
  }

  override fun close() = interpreter.close()

  companion object {
    const val SIZE = FaceAlign.SIZE
    const val DIM = 128

    /**
     * Makes sure Play services has the LiteRT engine (it downloads it on first use;
     * this can take a while on a slow network). False = not available right now.
     */
    fun prepare(context: Context, timeoutSec: Long = 120): Boolean =
      runCatching { Tasks.await(TfLite.initialize(context), timeoutSec, TimeUnit.SECONDS); true }.getOrDefault(false)

    /** Null when Play services has no LiteRT (phone without Play services): People stays hidden there. */
    fun open(context: Context, model: File, threads: Int = 2): FaceEmbedder? = runCatching {
      Tasks.await(TfLite.initialize(context), 30, TimeUnit.SECONDS)
      val options = InterpreterApi.Options()
        .setRuntime(InterpreterApi.Options.TfLiteRuntime.FROM_SYSTEM_ONLY)
        .setNumThreads(threads)
      FaceEmbedder(InterpreterApi.create(model, options))
    }.getOrNull()
  }
}
