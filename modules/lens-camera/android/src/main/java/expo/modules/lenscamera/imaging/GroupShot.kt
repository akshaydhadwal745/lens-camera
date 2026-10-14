package expo.modules.lenscamera.imaging

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapRegionDecoder
import android.graphics.Matrix
import android.graphics.Rect
import android.os.Build
import android.util.Log
import androidx.exifinterface.media.ExifInterface
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.mlkit.vision.face.FaceLandmark
import expo.modules.lenscamera.NightMerge
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/**
 * Best group photo (docs/design/switch-features.md §5): after a burst, if someone
 * blinked in the best shot but had their eyes open in another frame, their face
 * is taken from that frame (aligned, colour-matched, blended without a seam) into
 * the best shot. Everyone else, the background and the original frames stay
 * untouched. Refuses whenever it can't be natural: head turned, something in
 * front of the face, no frame with open eyes. Pixel work: GroupShotMath.
 */
object GroupShot {
  private const val TAG = "LensGroupShot"
  /** Long side of the copy faces are found on (fast, and plenty for landmarks). */
  private const val DETECT_SIDE = 1600
  private const val CLOSED = 0.4f
  private const val OPEN = 0.75f
  private const val MAX_YAW = 10f
  private const val MAX_ROLL = 8f
  private const val MIN_NCC = 0.6

  private val detector by lazy {
    FaceDetection.getClient(
      FaceDetectorOptions.Builder()
        .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
        .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
        .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
        .setMinFaceSize(0.04f)
        .build(),
    )
  }

  /** One face: 5 points (left eye, right eye, nose, mouth left, mouth right) in the file's own pixels. */
  class Person(val pts: Array<DoubleArray>, val eyes: Float, val smile: Float, val yaw: Float, val roll: Float) {
    val eyeDist get() = hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1])
    val nose get() = pts[2]
    fun mean() = doubleArrayOf(pts.sumOf { it[0] } / pts.size, pts.sumOf { it[1] } / pts.size)
  }

  data class Result(val file: File, val fixed: Int, val notes: List<String>)

  /**
   * The best shot with blinks fixed, written to `output`, or null when nothing
   * needed (or could safely get) fixing. `frames[base]` is the burst's pick.
   */
  fun fix(frames: List<File>, base: Int, output: File): Result? {
    if (frames.size < 2) return null
    val people = frames.map { runCatching { detect(it) }.getOrDefault(emptyList()) }
    val baseFaces = people[base]
    if (baseFaces.size < 2) return null // a group photo: at least two people
    val notes = mutableListOf<String>()
    val swaps = mutableListOf<Pair<Person, Pair<Int, Person>>>()
    for (face in baseFaces) {
      if (face.eyes >= CLOSED) continue
      val donor = frames.indices.filter { it != base }.mapNotNull { k ->
        val other = pair(face, baseFaces, people[k]) ?: return@mapNotNull null
        if (other.eyes < OPEN || abs(other.yaw - face.yaw) > MAX_YAW || abs(other.roll - face.roll) > MAX_ROLL) return@mapNotNull null
        k to other
      }.maxByOrNull { (k, other) -> other.eyes - 0.02f * abs(k - base) }
      if (donor == null) notes += "no frame with their eyes open" else swaps += face to donor
    }
    if (swaps.isEmpty()) return null

    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(frames[base].path, bounds)
    val full = BitmapFactory.decodeFile(frames[base].path, BitmapFactory.Options().apply { inMutable = true }) ?: return null
    var fixed = 0
    try {
      for ((face, donor) in swaps) {
        val why = swapOne(full, face, frames[donor.first], donor.second)
        if (why == null) fixed++ else notes += why
      }
      if (fixed == 0) return null
      FileOutputStream(output).use { full.compress(Bitmap.CompressFormat.JPEG, 95, it) }
      NightMerge.copyExif(frames[base], output)
      return Result(output, fixed, notes)
    } finally {
      full.recycle()
    }
  }

  /** The same person in another frame: nearest nose after the frames' overall offset, within half an eye distance. */
  private fun pair(face: Person, baseFaces: List<Person>, others: List<Person>): Person? {
    if (others.isEmpty()) return null
    // Overall hand movement between the frames: the median offset of every face's nearest match.
    val offsets = baseFaces.mapNotNull { b ->
      others.minByOrNull { hypot(it.nose[0] - b.nose[0], it.nose[1] - b.nose[1]) }?.let { doubleArrayOf(it.nose[0] - b.nose[0], it.nose[1] - b.nose[1]) }
    }
    val ox = offsets.map { it[0] }.sorted()[offsets.size / 2]
    val oy = offsets.map { it[1] }.sorted()[offsets.size / 2]
    val best = others.minBy { hypot(it.nose[0] - ox - face.nose[0], it.nose[1] - oy - face.nose[1]) }
    return best.takeIf { hypot(it.nose[0] - ox - face.nose[0], it.nose[1] - oy - face.nose[1]) < face.eyeDist / 2 }
  }

  /** One face from `donorFile` into `full` (the best shot, its own pixels). Null = done; else why not. */
  private fun swapOne(full: Bitmap, face: Person, donorFile: File, other: Person): String? {
    val d = face.eyeDist
    val eyesMid = doubleArrayOf((face.pts[0][0] + face.pts[1][0]) / 2, (face.pts[0][1] + face.pts[1][1]) / 2)
    val mouthMid = doubleArrayOf((face.pts[3][0] + face.pts[4][0]) / 2, (face.pts[3][1] + face.pts[4][1]) / 2)
    val cx = eyesMid[0] + (mouthMid[0] - eyesMid[0]) * 0.35
    val cy = eyesMid[1] + (mouthMid[1] - eyesMid[1]) * 0.35
    val r = (2.2 * d).toInt()
    val x0 = max(0, (cx - r).toInt())
    val y0 = max(0, (cy - r).toInt())
    val x1 = min(full.width, (cx + r).toInt())
    val y1 = min(full.height, (cy + r).toInt())
    val w = x1 - x0
    val h = y1 - y0
    if (w < 32 || h < 32) return "face too small"

    // The donor's same area (moved by where the face sits there), decoded as just that region.
    val t = other.mean().let { m -> face.mean().let { b -> doubleArrayOf(m[0] - b[0], m[1] - b[1]) } }
    val dx0 = (x0 + t[0]).toInt()
    val dy0 = (y0 + t[1]).toInt()
    val decoder = regionDecoder(donorFile) ?: return "couldn't read the other frame"
    val region = Rect(dx0, dy0, dx0 + w, dy0 + h)
    if (region.left < 0 || region.top < 0 || region.right > decoder.width || region.bottom > decoder.height) {
      decoder.recycle()
      return "face too close to the edge"
    }
    val donorBmp = decoder.decodeRegion(region, BitmapFactory.Options()) ?: return "couldn't read the other frame"
    decoder.recycle()
    val donorPx = IntArray(w * h).also { donorBmp.getPixels(it, 0, w, 0, 0, w, h) }
    donorBmp.recycle()
    val basePx = IntArray(w * h).also { full.getPixels(it, 0, w, x0, y0, w, h) }
    val baseRgb = GroupShotMath.Rgb.fromArgb(basePx, w, h)
    val donorRgb = GroupShotMath.Rgb.fromArgb(donorPx, w, h)

    // Align the face area densely, leaving the eye band out (it's what differs).
    val ex0 = face.pts[0][0] - x0
    val ey0 = face.pts[0][1] - y0
    val ex1 = face.pts[1][0] - x0
    val ey1 = face.pts[1][1] - y0
    val band = d * 0.28
    val use = BooleanArray(w * h) { i -> distToSegment(i % w.toDouble(), (i / w).toDouble(), ex0, ey0, ex1, ey1) > band }
    val motion = GroupShotMath.align(baseRgb.luma(), donorRgb.luma(), use, w, h)
    val warped = GroupShotMath.warp(donorRgb, motion)

    val angle = Math.toDegrees(atan2(ey1 - ey0, ex1 - ex0))
    val ccx = cx - x0
    val ccy = cy - y0
    val faceMask = GroupShotMath.ellipse(w, h, ccx, ccy, 1.05 * d, 1.45 * d, angle)
    val outer = GroupShotMath.ellipse(w, h, ccx, ccy, 1.05 * d * 1.45, 1.45 * d * 1.3, angle)
    val ring = BooleanArray(w * h) { outer[it] > 0 && faceMask[it] == 0f }

    // Guard: around the face both frames must show the same thing (no hand, hair or head turn in between).
    val ncc = GroupShotMath.ncc(baseRgb.luma(), warped.luma(), ring)
    if (ncc < MIN_NCC) return "something moved around their face"

    val recoloured = GroupShotMath.matchColour(baseRgb, warped, ring)
    val soft = GroupShotMath.blur(faceMask, w, h, d / 4)
    val out = GroupShotMath.blend(baseRgb, recoloured, soft)
    full.setPixels(out.toArgb(), 0, w, x0, y0, w, h)
    Log.i(TAG, "fixed a blink: eyes ${"%.2f".format(face.eyes)} → ${"%.2f".format(other.eyes)}, ncc ${"%.3f".format(ncc)}, motion $motion")
    return null
  }

  private fun distToSegment(px: Double, py: Double, ax: Double, ay: Double, bx: Double, by: Double): Double {
    val vx = bx - ax
    val vy = by - ay
    val len2 = vx * vx + vy * vy
    val k = if (len2 == 0.0) 0.0 else (((px - ax) * vx + (py - ay) * vy) / len2).coerceIn(0.0, 1.0)
    return hypot(px - (ax + k * vx), py - (ay + k * vy))
  }

  @Suppress("DEPRECATION")
  private fun regionDecoder(file: File): BitmapRegionDecoder? = runCatching {
    if (Build.VERSION.SDK_INT >= 31) BitmapRegionDecoder.newInstance(file.path) else BitmapRegionDecoder.newInstance(file.path, false)
  }.getOrNull()

  /** Faces in a frame, found on an upright small copy, mapped back to the file's own pixels. */
  private fun detect(file: File): List<Person> {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= DETECT_SIDE) sample *= 2
    val small = BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return emptyList()
    val degrees = runCatching { ExifInterface(file).rotationDegrees }.getOrDefault(0)
    val toUpright = Matrix().apply { postRotate(degrees.toFloat()) }
    val upright = if (degrees == 0) small else Bitmap.createBitmap(small, 0, 0, small.width, small.height, toUpright, true)
    // createBitmap shifts the rotated image to start at 0,0: the same shift maps points back.
    val rotatedBox = android.graphics.RectF(0f, 0f, small.width.toFloat(), small.height.toFloat()).also { toUpright.mapRect(it) }
    toUpright.postTranslate(-rotatedBox.left, -rotatedBox.top)
    val back = Matrix().also { toUpright.invert(it) }
    val faces: List<Face> = Tasks.await(detector.process(InputImage.fromBitmap(upright, 0)), 5, TimeUnit.SECONDS)
    val sx = bounds.outWidth.toDouble() / small.width
    val sy = bounds.outHeight.toDouble() / small.height
    val out = faces.mapNotNull { f ->
      val types = intArrayOf(FaceLandmark.LEFT_EYE, FaceLandmark.RIGHT_EYE, FaceLandmark.NOSE_BASE, FaceLandmark.MOUTH_LEFT, FaceLandmark.MOUTH_RIGHT)
      val marks = types.map { f.getLandmark(it)?.position ?: return@mapNotNull null }
      val pts = marks.map { p ->
        val xy = floatArrayOf(p.x, p.y).also { back.mapPoints(it) }
        doubleArrayOf(xy[0] * sx, xy[1] * sy)
      }.toTypedArray()
      val eyes = min(f.leftEyeOpenProbability ?: return@mapNotNull null, f.rightEyeOpenProbability ?: return@mapNotNull null)
      Person(pts, eyes, f.smilingProbability ?: 0f, f.headEulerAngleY, f.headEulerAngleZ)
    }
    if (upright !== small) upright.recycle()
    small.recycle()
    return out
  }
}
