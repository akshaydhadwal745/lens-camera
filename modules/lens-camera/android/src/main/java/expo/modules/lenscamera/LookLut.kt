package expo.modules.lenscamera

import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * The 13 creative looks as pure colour transforms, baked into 33³ lookup
 * tables. Same catalogue and recipe steps as ios/Imaging/Looks.swift (ids are
 * mirrored in src/lib/edits.ts). A LUT is one texture lookup per pixel on the
 * GPU, cheap enough for the live viewfinder on budget phones.
 *
 * If exact LUTs baked from the iOS implementation are bundled as assets
 * (assets/looks/<id>.png), they take precedence (see [LookAssets]); this
 * Kotlin version is the built-in definition.
 *
 * Pure Kotlin (no Android types) so it can be unit tested on the JVM.
 */
object LookLut {
  const val SIZE = 33

  val IDS = listOf(
    "natural", "vivid", "warm", "cool", "golden", "cinematic", "film",
    "moody", "fade", "bw", "noir", "vintage", "chrome",
  )

  // ---------- Building blocks (values are gamma-encoded sRGB, 0…1) ----------

  private fun luma(c: DoubleArray) = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

  private fun controls(c: DoubleArray, saturation: Double = 1.0, brightness: Double = 0.0, contrast: Double = 1.0): DoubleArray {
    val l = luma(c)
    return DoubleArray(3) { i ->
      val s = l + (c[i] - l) * saturation
      (s - 0.5) * contrast + 0.5 + brightness
    }
  }

  /** Boosts saturation of the less saturated colours most (like CIVibrance). */
  private fun vibrance(c: DoubleArray, amount: Double): DoubleArray {
    val mx = max(c[0], max(c[1], c[2]))
    val mn = min(c[0], min(c[1], c[2]))
    val sat = mx - mn
    val scale = 1 + amount * (1 - sat) * 1.5
    val l = luma(c)
    return DoubleArray(3) { i -> l + (c[i] - l) * scale }
  }

  private fun gains(c: DoubleArray, r: Double, g: Double, b: Double, bias: DoubleArray = ZERO) =
    doubleArrayOf(c[0] * r + bias[0], c[1] * g + bias[1], c[2] * b + bias[2])

  private fun curve(c: DoubleArray, points: List<Pair<Double, Double>>): DoubleArray {
    val spline = Spline(points)
    return DoubleArray(3) { i -> spline(c[i]) }
  }

  private fun splitTone(c: DoubleArray, shadows: DoubleArray, highlights: DoubleArray): DoubleArray {
    val m = luma(c).coerceIn(0.0, 1.0)
    return DoubleArray(3) { i -> (c[i] + shadows[i]) * (1 - m) + (c[i] + highlights[i]) * m }
  }

  private fun exposure(c: DoubleArray, ev: Double): DoubleArray {
    val k = 2.0.pow(ev)
    return DoubleArray(3) { i -> toGamma(toLinear(c[i]) * k) }
  }

  private fun mono(c: DoubleArray, contrast: Double): DoubleArray {
    val l = luma(c)
    return controls(doubleArrayOf(l, l, l), contrast = contrast)
  }

  private fun clamp(c: DoubleArray) = DoubleArray(3) { c[it].coerceIn(0.0, 1.0) }

  // ---------- Looks ----------

  /** The look at full strength (identity for unknown ids). */
  fun apply(id: String, input: DoubleArray): DoubleArray {
    val c = input
    val out = when (id) {
      "natural" -> controls(vibrance(c, 0.15), contrast = 1.04)
      "vivid" -> controls(vibrance(c, 0.2), saturation = 1.25, contrast = 1.12)
      "warm" -> curve(gains(c, 1.06, 1.0, 0.92), listOf(0.0 to 0.02, 0.25 to 0.26, 0.5 to 0.51, 0.75 to 0.76, 1.0 to 1.0))
      "cool" -> gains(c, 0.94, 1.0, 1.07)
      "golden" -> splitTone(
        gains(vibrance(c, 0.25), 1.08, 1.02, 0.88),
        doubleArrayOf(0.0, -0.01, 0.02),
        doubleArrayOf(0.06, 0.03, -0.03),
      )
      "cinematic" -> controls(
        splitTone(c, doubleArrayOf(-0.02, 0.05, 0.07), doubleArrayOf(0.08, 0.03, -0.04)),
        saturation = 0.9,
        contrast = 1.1,
      )
      "film" -> controls(
        gains(curve(c, listOf(0.0 to 0.06, 0.25 to 0.24, 0.5 to 0.52, 0.75 to 0.79, 1.0 to 0.96)), 1.03, 1.0, 0.96),
        saturation = 0.92,
      )
      "moody" -> controls(
        splitTone(exposure(c, -0.2), doubleArrayOf(-0.02, 0.0, 0.04), doubleArrayOf(0.02, 0.01, -0.01)),
        saturation = 0.75,
        contrast = 1.15,
      )
      "fade" -> controls(curve(c, listOf(0.0 to 0.12, 0.25 to 0.3, 0.5 to 0.53, 0.75 to 0.76, 1.0 to 0.95)), saturation = 0.85)
      "bw" -> controls(c, saturation = 0.0, contrast = 1.1)
      // Apple's Noir / Instant / Chrome photo effects, matched by eye.
      "noir" -> curve(mono(c, 1.0), listOf(0.0 to 0.0, 0.25 to 0.15, 0.5 to 0.5, 0.75 to 0.86, 1.0 to 1.0))
      "vintage" -> curve(
        controls(splitTone(c, doubleArrayOf(0.02, 0.0, 0.05), doubleArrayOf(0.05, 0.04, -0.05)), saturation = 0.8, contrast = 0.92),
        listOf(0.0 to 0.05, 0.25 to 0.27, 0.5 to 0.52, 0.75 to 0.77, 1.0 to 0.97),
      )
      "chrome" -> controls(vibrance(c, 0.2), saturation = 1.2, contrast = 1.12, brightness = 0.01)
      else -> c
    }
    return clamp(out)
  }

  /**
   * The LUT as RGBA bytes for a 2D strip texture: width SIZE·SIZE (one SIZE×SIZE
   * slice per blue level, side by side), height SIZE. A 2D strip (not a 3D
   * texture) works with OpenGL ES 2.0, so even very old GPUs run looks.
   */
  fun bakeStrip(id: String): ByteArray {
    val n = SIZE
    val out = ByteArray(n * n * n * 4)
    val c = DoubleArray(3)
    for (b in 0 until n) for (g in 0 until n) for (r in 0 until n) {
      c[0] = r / (n - 1.0)
      c[1] = g / (n - 1.0)
      c[2] = b / (n - 1.0)
      val o = apply(id, c)
      // Row g, column b·n + r.
      val i = ((g * n * n) + b * n + r) * 4
      out[i] = (o[0] * 255 + 0.5).toInt().toByte()
      out[i + 1] = (o[1] * 255 + 0.5).toInt().toByte()
      out[i + 2] = (o[2] * 255 + 0.5).toInt().toByte()
      out[i + 3] = 0xFF.toByte()
    }
    return out
  }

  fun toLinear(v: Double): Double {
    val x = v.coerceIn(0.0, 1.0)
    return if (x <= 0.04045) x / 12.92 else ((x + 0.055) / 1.055).pow(2.4)
  }

  fun toGamma(v: Double): Double {
    val x = v.coerceIn(0.0, 1.0)
    return if (x <= 0.0031308) x * 12.92 else 1.055 * x.pow(1 / 2.4) - 0.055
  }

  private val ZERO = doubleArrayOf(0.0, 0.0, 0.0)

  /** Natural cubic spline through the curve points (like CIToneCurve). */
  class Spline(points: List<Pair<Double, Double>>) {
    private val xs = points.map { it.first }.toDoubleArray()
    private val ys = points.map { it.second }.toDoubleArray()
    private val m = DoubleArray(xs.size)

    init {
      val n = xs.size
      if (n > 2) {
        val a = DoubleArray(n)
        val b = DoubleArray(n)
        val c = DoubleArray(n)
        val d = DoubleArray(n)
        for (i in 1 until n - 1) {
          val h0 = xs[i] - xs[i - 1]
          val h1 = xs[i + 1] - xs[i]
          a[i] = h0
          b[i] = 2 * (h0 + h1)
          c[i] = h1
          d[i] = 6 * ((ys[i + 1] - ys[i]) / h1 - (ys[i] - ys[i - 1]) / h0)
        }
        // Thomas algorithm, natural boundaries (m[0] = m[n-1] = 0).
        for (i in 2 until n - 1) {
          val w = a[i] / b[i - 1]
          b[i] -= w * c[i - 1]
          d[i] -= w * d[i - 1]
        }
        for (i in n - 2 downTo 1) {
          m[i] = (d[i] - c[i] * m[i + 1]) / b[i]
        }
      }
    }

    operator fun invoke(x: Double): Double {
      val n = xs.size
      if (x <= xs[0]) return ys[0] + (x - xs[0]) * slope(0)
      if (x >= xs[n - 1]) return ys[n - 1] + (x - xs[n - 1]) * slope(n - 2)
      var i = 0
      while (x > xs[i + 1]) i++
      val h = xs[i + 1] - xs[i]
      val t = x - xs[i]
      val u = xs[i + 1] - x
      return m[i] * u * u * u / (6 * h) + m[i + 1] * t * t * t / (6 * h) +
        (ys[i] / h - m[i] * h / 6) * u + (ys[i + 1] / h - m[i + 1] * h / 6) * t
    }

    private fun slope(i: Int) = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i])
  }
}
