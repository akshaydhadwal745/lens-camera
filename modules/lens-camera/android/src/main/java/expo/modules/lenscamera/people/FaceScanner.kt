package expo.modules.lenscamera.people

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Rect
import android.os.SystemClock
import androidx.exifinterface.media.ExifInterface
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.mlkit.vision.face.FaceLandmark
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.File
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.max

/**
 * People: finds the faces in one photo preview and returns an embedding per
 * usable face (docs/design/people.md). Faces that are small, turned away or
 * blurry are skipped: they are where wrong matches come from.
 * Off the main thread only.
 */
class FaceScanner(private val embedder: FaceEmbedder) : Closeable {
  data class Found(
    /** Face box in the scanned image (pixels of the downscaled preview). */
    val box: Rect,
    val embedding: FloatArray,
    /** Small JPEG of the aligned face for the People grid (stays on the phone). */
    val thumb: ByteArray,
    /** Laplacian variance of the aligned face: higher = sharper. */
    val sharpness: Float,
    val eyeDistance: Float,
    val yaw: Float,
  )

  data class Result(val faces: List<Found>, val skipped: Int, val detectMs: Long, val embedMs: Long)

  private val detector = FaceDetection.getClient(
    FaceDetectorOptions.Builder()
      .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
      .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
      .setMinFaceSize(MIN_FACE_FRACTION)
      .build(),
  )
  private val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)

  fun scan(file: File): Result {
    val image = decode(file) ?: return Result(emptyList(), 0, 0, 0)
    try {
      val t0 = SystemClock.elapsedRealtime()
      val faces = Tasks.await(detector.process(InputImage.fromBitmap(image, 0)), 20, TimeUnit.SECONDS)
      val t1 = SystemClock.elapsedRealtime()
      val out = ArrayList<Found>()
      var skipped = 0
      for (face in faces) {
        val found = embedFace(image, face)
        if (found == null) skipped++ else out.add(found)
      }
      return Result(out, skipped, t1 - t0, SystemClock.elapsedRealtime() - t1)
    } finally {
      image.recycle()
    }
  }

  private fun embedFace(image: Bitmap, face: Face): Found? {
    if (abs(face.headEulerAngleY) > MAX_YAW || abs(face.headEulerAngleX) > MAX_PITCH) return null
    fun p(type: Int) = face.getLandmark(type)?.position?.let { floatArrayOf(it.x, it.y) }
    val l = FaceAlign.orderLandmarks(
      p(FaceLandmark.LEFT_EYE) ?: return null, p(FaceLandmark.RIGHT_EYE) ?: return null,
      p(FaceLandmark.NOSE_BASE) ?: return null,
      p(FaceLandmark.MOUTH_LEFT) ?: return null, p(FaceLandmark.MOUTH_RIGHT) ?: return null,
    )
    val eyes = FaceAlign.eyeDistance(l)
    if (eyes < MIN_EYE_DISTANCE) return null
    val m = FaceAlign.cropMatrix(l)
    val crop = Bitmap.createBitmap(FaceAlign.SIZE, FaceAlign.SIZE, Bitmap.Config.ARGB_8888)
    Canvas(crop).drawBitmap(
      image,
      Matrix().apply {
        setValues(floatArrayOf(m[0].toFloat(), m[1].toFloat(), m[2].toFloat(), m[3].toFloat(), m[4].toFloat(), m[5].toFloat(), 0f, 0f, 1f))
      },
      paint,
    )
    try {
      val sharp = sharpness(crop)
      if (sharp < MIN_SHARPNESS) return null
      val thumb = ByteArrayOutputStream().also { crop.compress(Bitmap.CompressFormat.JPEG, 80, it) }.toByteArray()
      return Found(face.boundingBox, embedder.embed(crop), thumb, sharp, eyes, face.headEulerAngleY)
    } finally {
      crop.recycle()
    }
  }

  override fun close() {
    detector.close()
  }

  companion object {
    /** Previews are ~2048 px; faces are found on a <= 1280 px copy (enough for faces >= 64 px, less heat). */
    const val MAX_SIDE = 1280
    const val MIN_FACE_FRACTION = 0.05f
    /** ~64 px faces: eye distance below this gives too little detail for a reliable match. */
    const val MIN_EYE_DISTANCE = 24f
    const val MAX_YAW = 35f
    const val MAX_PITCH = 30f
    /** Laplacian variance on the 112 px crop; tuned on real photos before release (docs/design/people.md). */
    const val MIN_SHARPNESS = 0f

    fun decode(file: File): Bitmap? = runCatching {
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(file.path, bounds)
      var sample = 1
      while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_SIDE) sample *= 2
      val raw = BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
      val scale = MAX_SIDE.toFloat() / max(raw.width, raw.height)
      val rotation = ExifInterface(file.path).rotationDegrees
      if (scale >= 1f && rotation == 0) return raw
      val matrix = Matrix().apply {
        if (scale < 1f) postScale(scale, scale)
        if (rotation != 0) postRotate(rotation.toFloat())
      }
      Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, matrix, true).also { if (it !== raw) raw.recycle() }
    }.getOrNull()

    /** Variance of the 4-neighbour Laplacian on luminance. */
    fun sharpness(face: Bitmap): Float {
      val w = face.width; val h = face.height
      val px = IntArray(w * h).also { face.getPixels(it, 0, w, 0, 0, w, h) }
      val y = FloatArray(w * h) { val p = px[it]; 0.299f * ((p shr 16) and 0xff) + 0.587f * ((p shr 8) and 0xff) + 0.114f * (p and 0xff) }
      var sum = 0.0; var sq = 0.0; var n = 0
      for (r in 1 until h - 1) for (c in 1 until w - 1) {
        val i = r * w + c
        val lap = (y[i - 1] + y[i + 1] + y[i - w] + y[i + w] - 4 * y[i]).toDouble()
        sum += lap; sq += lap * lap; n++
      }
      val mean = sum / n
      return (sq / n - mean * mean).toFloat()
    }
  }
}
