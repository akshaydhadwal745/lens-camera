package expo.modules.lenscamera.people

import kotlin.math.abs
import kotlin.math.sqrt

/**
 * People (docs/design/people.md): turns a face's landmarks into the 112x112 crop
 * SFace was trained on. Same maths as research/faces/spike.py (checked there
 * against OpenCV's FaceRecognizerSF.alignCrop: identical crops).
 */
object FaceAlign {
  const val SIZE = 112

  /** SFace/ArcFace template (image coordinates): eye, eye, nose tip, mouth corner, mouth corner. */
  val TEMPLATE = arrayOf(
    floatArrayOf(38.2946f, 51.6963f), floatArrayOf(73.5318f, 51.5014f), floatArrayOf(56.0252f, 71.7366f),
    floatArrayOf(41.5493f, 92.3655f), floatArrayOf(70.7299f, 92.2041f),
  )

  /** Template points used: 4 = eyes + mouth corners (ML Kit's nose point is the nose base, not the tip). */
  val USE = intArrayOf(0, 1, 3, 4)

  /**
   * Least-squares similarity transform (rotation, uniform scale, shift) mapping
   * [src] onto [dst] (Umeyama). Returns the 2x3 matrix row-major:
   * [a, -b, tx, b, a, ty] style values as {m00, m01, m02, m10, m11, m12}.
   */
  fun similarity(src: Array<FloatArray>, dst: Array<FloatArray>): DoubleArray {
    val n = src.size
    var msx = 0.0; var msy = 0.0; var mdx = 0.0; var mdy = 0.0
    for (i in 0 until n) { msx += src[i][0]; msy += src[i][1]; mdx += dst[i][0]; mdy += dst[i][1] }
    msx /= n; msy /= n; mdx /= n; mdy /= n
    // Covariance (dst x src) and source variance.
    var c00 = 0.0; var c01 = 0.0; var c10 = 0.0; var c11 = 0.0; var varS = 0.0
    for (i in 0 until n) {
      val sx = src[i][0] - msx; val sy = src[i][1] - msy
      val dx = dst[i][0] - mdx; val dy = dst[i][1] - mdy
      c00 += dx * sx; c01 += dx * sy; c10 += dy * sx; c11 += dy * sy
      varS += sx * sx + sy * sy
    }
    c00 /= n; c01 /= n; c10 /= n; c11 /= n; varS /= n
    // For 2-D, the optimal rotation + scale has the closed form below (equivalent to the SVD solution
    // when det(cov) >= 0, which holds for a face that isn't mirrored).
    val a = c00 + c11
    val b = c10 - c01
    val norm = sqrt(a * a + b * b)
    if (norm < 1e-12 || varS < 1e-12) return doubleArrayOf(1.0, 0.0, mdx - msx, 0.0, 1.0, mdy - msy)
    val cos = a / norm; val sin = b / norm
    // Scale = trace(D·S)/varS = (sigma1 + sign·sigma2)/varS = norm/varS for a proper rotation.
    val scale = norm / varS
    val m00 = scale * cos; val m01 = -scale * sin
    val m10 = scale * sin; val m11 = scale * cos
    return doubleArrayOf(m00, m01, mdx - (m00 * msx + m01 * msy), m10, m11, mdy - (m10 * msx + m11 * msy))
  }

  /**
   * Five landmarks in any order → template order: the eye pair and mouth pair are
   * sorted by x (image-left first), so ML Kit's "left/right" naming can't swap them.
   */
  fun orderLandmarks(eyeA: FloatArray, eyeB: FloatArray, nose: FloatArray, mouthA: FloatArray, mouthB: FloatArray): Array<FloatArray> {
    val (e0, e1) = if (eyeA[0] <= eyeB[0]) eyeA to eyeB else eyeB to eyeA
    val (m0, m1) = if (mouthA[0] <= mouthB[0]) mouthA to mouthB else mouthB to mouthA
    return arrayOf(e0, e1, nose, m0, m1)
  }

  /** Matrix that maps the face (template-ordered landmarks) into the 112x112 crop, using [USE] points. */
  fun cropMatrix(landmarks: Array<FloatArray>, use: IntArray = USE): DoubleArray =
    similarity(Array(use.size) { landmarks[use[it]] }, Array(use.size) { TEMPLATE[use[it]] })

  /** Rough eye distance in the source image (px): faces below ~30 px eye distance are too small to trust. */
  fun eyeDistance(landmarks: Array<FloatArray>): Float {
    val dx = landmarks[1][0] - landmarks[0][0]; val dy = landmarks[1][1] - landmarks[0][1]
    return sqrt(dx * dx + dy * dy)
  }

  fun cosine(a: FloatArray, b: FloatArray): Float {
    var dot = 0.0; var na = 0.0; var nb = 0.0
    for (i in a.indices) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
    return if (na == 0.0 || nb == 0.0) 0f else (dot / sqrt(na * nb)).toFloat()
  }

  fun normalize(v: FloatArray): FloatArray {
    var n = 0.0
    for (x in v) n += x * x
    n = sqrt(n)
    return if (n == 0.0) v else FloatArray(v.size) { (v[it] / n).toFloat() }
  }

  internal fun close(a: Double, b: Double, tol: Double) = abs(a - b) <= tol
}
