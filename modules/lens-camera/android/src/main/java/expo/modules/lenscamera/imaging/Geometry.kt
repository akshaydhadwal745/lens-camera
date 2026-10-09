package expo.modules.lenscamera.imaging

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Where each output pixel comes from in the stored image.
 *
 * Steps, as in ios/Imaging/ImagePipeline.swift `applyCrop`: EXIF orientation
 * (to upright) → quarter turns clockwise → horizontal flip → straighten (rotate
 * and crop to the largest upright rectangle) → crop rect. Every step is affine,
 * so the whole chain is one 2×3 matrix from output coordinates (0…1, origin
 * top-left) to stored-image coordinates (0…1, origin top-left). That's what lets
 * huge photos be rendered tile by tile.
 *
 * Pure Kotlin so it can be unit tested on the JVM.
 */
class Geometry(storedWidth: Int, storedHeight: Int, exifOrientation: Int, crop: EditRecipe.Crop?) {
  /** Row-major 2×3: [a, b, c, d, e, f] → x' = a·x + b·y + c, y' = d·x + e·y + f. */
  val matrix: DoubleArray
  /** Output size at full resolution, in pixels. */
  val outputWidth: Int
  val outputHeight: Int

  init {
    val transposed = exifOrientation in 5..8
    val uw = (if (transposed) storedHeight else storedWidth).toDouble()
    val uh = (if (transposed) storedWidth else storedHeight).toDouble()

    // Upright -> stored.
    var m = exifToStored(exifOrientation)

    // Quarter turns: rotated image -> upright.
    val turns = (((crop?.rotate ?: 0) % 4) + 4) % 4
    val (rw, rh) = if (turns % 2 == 1) uh to uw else uw to uh
    m = m * quarterTurnToUpright(turns)

    // Flip: flipped -> rotated.
    if (crop?.flip == true) m = m * Affine(-1.0, 0.0, 1.0, 0.0, 1.0, 0.0)

    // Straighten: inner rectangle of the rotated content -> flipped image.
    var sw = rw
    var sh = rh
    val degrees = crop?.straighten ?: 0.0
    if (abs(degrees) > 0.01) {
      val theta = Math.toRadians(abs(degrees))
      val s = min(rw / (rw * cos(theta) + rh * sin(theta)), rh / (rw * sin(theta) + rh * cos(theta)))
      sw = rw * s
      sh = rh * s
      // Pixel space, centred: q = R(-θ)·p (content was rotated clockwise by θ).
      val t = Math.toRadians(degrees)
      val c = cos(-t)
      val sn = sin(-t)
      // normalized straightened (a,b) -> pixel centred -> rotate -> flipped pixel -> normalized.
      val toPixel = Affine(sw, 0.0, -sw / 2, 0.0, sh, -sh / 2)
      val rotate = Affine(c, -sn, 0.0, sn, c, 0.0)
      val toNorm = Affine(1 / rw, 0.0, 0.5, 0.0, 1 / rh, 0.5)
      m = m * (toNorm * rotate * toPixel)
    }

    // Crop rect (normalized, in the straightened image).
    var ow = sw
    var oh = sh
    if (crop != null) {
      val x = crop.x
      val y = crop.y
      val w = crop.w
      val h = crop.h
      if (x != null && y != null && w != null && h != null && w > 0 && h > 0 && (w < 1 || h < 1 || x > 0 || y > 0)) {
        m = m * Affine(w, 0.0, x, 0.0, h, y)
        ow = sw * w
        oh = sh * h
      }
    }
    matrix = m.values
    outputWidth = max(1, ow.roundToInt())
    outputHeight = max(1, oh.roundToInt())
  }

  /** Maps an output point (0…1) to the stored image (0…1). */
  fun map(x: Double, y: Double): Pair<Double, Double> =
    (matrix[0] * x + matrix[1] * y + matrix[2]) to (matrix[3] * x + matrix[4] * y + matrix[5])

  /** Stored-image bounding box (0…1, clamped) of an output rectangle (0…1). */
  fun sourceBounds(x0: Double, y0: Double, x1: Double, y1: Double): DoubleArray {
    val pts = listOf(map(x0, y0), map(x1, y0), map(x0, y1), map(x1, y1))
    return doubleArrayOf(
      pts.minOf { it.first }.coerceIn(0.0, 1.0),
      pts.minOf { it.second }.coerceIn(0.0, 1.0),
      pts.maxOf { it.first }.coerceIn(0.0, 1.0),
      pts.maxOf { it.second }.coerceIn(0.0, 1.0),
    )
  }

  /** Stored pixels per output pixel (≥ 1 means the output is smaller). */
  fun sourcePixelsPerOutputPixel(storedWidth: Int, storedHeight: Int): Double {
    val (ax, ay) = map(0.0, 0.0)
    val (bx, by) = map(1.0, 0.0)
    val dx = (bx - ax) * storedWidth
    val dy = (by - ay) * storedHeight
    return kotlin.math.sqrt(dx * dx + dy * dy) / outputWidth
  }

  data class Affine(val a: Double, val b: Double, val c: Double, val d: Double, val e: Double, val f: Double) {
    val values get() = doubleArrayOf(a, b, c, d, e, f)

    /** (this * other)(p) = this(other(p)). */
    operator fun times(o: Affine) = Affine(
      a * o.a + b * o.d, a * o.b + b * o.e, a * o.c + b * o.f + c,
      d * o.a + e * o.d, d * o.b + e * o.e, d * o.c + e * o.f + f,
    )
  }

  companion object {
    val IDENTITY = Affine(1.0, 0.0, 0.0, 0.0, 1.0, 0.0)

    /** Upright (0…1) -> stored (0…1) for an EXIF orientation. */
    fun exifToStored(orientation: Int): Affine = when (orientation) {
      2 -> Affine(-1.0, 0.0, 1.0, 0.0, 1.0, 0.0)
      3 -> Affine(-1.0, 0.0, 1.0, 0.0, -1.0, 1.0)
      4 -> Affine(1.0, 0.0, 0.0, 0.0, -1.0, 1.0)
      5 -> Affine(0.0, 1.0, 0.0, 1.0, 0.0, 0.0)
      6 -> Affine(0.0, 1.0, 0.0, -1.0, 0.0, 1.0)
      7 -> Affine(0.0, -1.0, 1.0, -1.0, 0.0, 1.0)
      8 -> Affine(0.0, -1.0, 1.0, 1.0, 0.0, 0.0)
      else -> IDENTITY
    }

    /** Image turned `turns` × 90° clockwise (0…1) -> the unturned image (0…1). */
    fun quarterTurnToUpright(turns: Int): Affine = when (turns) {
      1 -> Affine(0.0, 1.0, 0.0, -1.0, 0.0, 1.0)
      2 -> Affine(-1.0, 0.0, 1.0, 0.0, -1.0, 1.0)
      3 -> Affine(0.0, -1.0, 1.0, 1.0, 0.0, 0.0)
      else -> IDENTITY
    }
  }
}
