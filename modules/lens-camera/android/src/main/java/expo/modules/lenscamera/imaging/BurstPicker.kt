package expo.modules.lenscamera.imaging

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import java.io.File
import java.util.concurrent.TimeUnit
import kotlin.math.max

/**
 * Smart burst (checklist 7.3): which shot of a burst is the keeper.
 * Score = sharpness (Laplacian variance of a ~512 px copy, normalised within the
 * burst) + eyes open and smiles where faces are found (ML Kit face detection via
 * Play services; without it, sharpness alone). Runs on a background thread after
 * the burst; ~30–60 ms per shot.
 */
object BurstPicker {
  private const val TAG = "LensBurst"

  private val faces by lazy {
    FaceDetection.getClient(
      FaceDetectorOptions.Builder()
        .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
        .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
        .build(),
    )
  }

  data class Shot(val sharpness: Double, val faces: Int, val eyesOpen: Double, val smile: Double)

  /** Index of the best shot and each shot's measurements. */
  fun pick(files: List<File>): Pair<Int, List<Shot>> {
    val shots = files.map { measure(it) }
    if (shots.isEmpty()) return 0 to shots
    val maxSharp = shots.maxOf { it.sharpness }.takeIf { it > 0 } ?: 1.0
    val anyFaces = shots.any { it.faces > 0 }
    val scores = shots.map { s ->
      val sharp = s.sharpness / maxSharp
      // With people: eyes open matter most, then sharpness, then a smile.
      if (anyFaces) 0.45 * sharp + 0.4 * s.eyesOpen + 0.15 * s.smile else sharp
    }
    return scores.indices.maxByOrNull { scores[it] }!! to shots
  }

  private fun measure(file: File): Shot {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 512) sample *= 2
    val bitmap = BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })
      ?: return Shot(0.0, 0, 0.0, 0.0)
    val sharpness = laplacianVariance(bitmap)
    var count = 0
    var eyes = 0.0
    var smile = 0.0
    try {
      // EXIF rotation doesn't matter for these scores; the detector handles any upright angle poorly,
      // so a missed face just means sharpness decides.
      val found = Tasks.await(faces.process(InputImage.fromBitmap(bitmap, 0)), 3, TimeUnit.SECONDS)
      count = found.size
      if (count > 0) {
        eyes = found.map { minOf(it.leftEyeOpenProbability ?: 0.5f, it.rightEyeOpenProbability ?: 0.5f).toDouble() }.average()
        smile = found.map { (it.smilingProbability ?: 0f).toDouble() }.average()
      }
    } catch (e: Exception) {
      Log.i(TAG, "face scoring unavailable: ${e.message}")
    }
    bitmap.recycle()
    return Shot(sharpness, count, eyes, smile)
  }

  /** Variance of the 4-neighbour Laplacian on luma: higher = sharper (less blur/shake). */
  internal fun laplacianVariance(bitmap: Bitmap): Double {
    val w = bitmap.width
    val h = bitmap.height
    val px = IntArray(w * h).also { bitmap.getPixels(it, 0, w, 0, 0, w, h) }
    val l = FloatArray(w * h) { i ->
      val c = px[i]
      0.299f * ((c shr 16) and 0xFF) + 0.587f * ((c shr 8) and 0xFF) + 0.114f * (c and 0xFF)
    }
    return laplacianVariance(l, w, h)
  }

  internal fun laplacianVariance(l: FloatArray, w: Int, h: Int): Double {
    var sum = 0.0
    var sq = 0.0
    var n = 0
    for (y in 1 until h - 1) for (x in 1 until w - 1) {
      val k = y * w + x
      val v = (4 * l[k] - l[k - 1] - l[k + 1] - l[k - w] - l[k + w]).toDouble()
      sum += v
      sq += v * v
      n++
    }
    if (n == 0) return 0.0
    val mean = sum / n
    return sq / n - mean * mean
  }
}
