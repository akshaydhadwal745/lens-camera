package expo.modules.lenscamera

import kotlin.math.abs
import kotlin.math.ln
import kotlin.math.max

/**
 * Colour temperature (Kelvin) <-> Camera2 white-balance gains.
 *
 * Camera2 white balance is applied in two steps: per-channel gains on the raw
 * sensor values, then a 3×3 colour correction matrix (CCM) to linear sRGB. The
 * model here: white under an illuminant of temperature T has the linear sRGB
 * colour of the Planckian locus at T; its sensor response is roughly
 * CCM⁻¹ · rgb(T); the gains that make it neutral are the reciprocal of that.
 *
 * Absolute accuracy depends on the phone's calibration, so manual white balance
 * is anchored on what auto white balance was doing (see [Anchor]): switching to
 * manual at the temperature auto reported gives exactly the same picture, and
 * moving the dial changes it in calibrated steps from there.
 *
 * Pure Kotlin (no Android types) so it can be unit tested on the JVM.
 */
object ColorTemperature {
  const val MIN_KELVIN = 2000.0
  const val MAX_KELVIN = 10000.0

  /** Gains are (r, g, b) with green = 1. */
  data class Gains(val r: Double, val g: Double, val b: Double) {
    fun normalized(): Gains = Gains(r / g, 1.0, b / g)
  }

  /** CIE 1931 xy of the Planckian locus (Kim et al. 2002), valid 1667–25000 K. */
  fun planckianXy(kelvin: Double): Pair<Double, Double> {
    val t = kelvin.coerceIn(1667.0, 25000.0)
    val t2 = t * t
    val t3 = t2 * t
    val x = if (t <= 4000) {
      -0.2661239e9 / t3 - 0.2343589e6 / t2 + 0.8776956e3 / t + 0.179910
    } else {
      -3.0258469e9 / t3 + 2.1070379e6 / t2 + 0.2226347e3 / t + 0.240390
    }
    val x2 = x * x
    val x3 = x2 * x
    val y = when {
      t <= 2222 -> -1.1063814 * x3 - 1.34811020 * x2 + 2.18555832 * x - 0.20219683
      t <= 4000 -> -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867
      else -> 3.0817580 * x3 - 5.87338670 * x2 + 3.75112997 * x - 0.37001483
    }
    return x to y
  }

  /** Linear sRGB of white light at [kelvin], scaled to green = 1. */
  fun linearRgb(kelvin: Double): DoubleArray {
    val (x, y) = planckianXy(kelvin)
    val bigX = x / y
    val bigZ = (1 - x - y) / y
    val r = 3.2404542 * bigX - 1.5371385 - 0.4985314 * bigZ
    val g = -0.9692660 * bigX + 1.8760108 + 0.0415560 * bigZ
    val b = 0.0556434 * bigX - 0.2040259 + 1.0572252 * bigZ
    return doubleArrayOf(max(r, 1e-4) / g, 1.0, max(b, 1e-4) / g)
  }

  /** The locus point nearest D65, so that 6504 K maps to (1,1,1). */
  private val d65 by lazy { linearRgb(6504.0) }

  /** White of [kelvin] relative to the sRGB white point. */
  private fun relativeRgb(kelvin: Double): DoubleArray {
    val rgb = linearRgb(kelvin)
    return doubleArrayOf(rgb[0] / d65[0], 1.0, rgb[2] / d65[2])
  }

  /**
   * Model gains for [kelvin]. [ccm] is the row-major 3×3 sensor→sRGB matrix
   * (identity if unknown).
   */
  fun modelGains(kelvin: Double, ccm: DoubleArray = IDENTITY): Gains {
    val inv = invert3(ccm) ?: IDENTITY
    val sensor = multiply3(inv, relativeRgb(kelvin))
    return Gains(1 / max(sensor[0], 1e-6), 1 / max(sensor[1], 1e-6), 1 / max(sensor[2], 1e-6)).normalized()
  }

  /** Temperature whose model gains are closest to [gains] (log-ratio distance). */
  fun estimateKelvin(gains: Gains, ccm: DoubleArray = IDENTITY): Double {
    val target = gains.normalized()
    var best = 5500.0
    var bestDistance = Double.MAX_VALUE
    var k = MIN_KELVIN
    while (k <= MAX_KELVIN) {
      val m = modelGains(k, ccm)
      val d = sq(ln(m.r) - ln(target.r)) + sq(ln(m.b) - ln(target.b))
      if (d < bestDistance) {
        bestDistance = d
        best = k
      }
      k += 25.0
    }
    return best
  }

  /**
   * Ties the model to the phone's own auto white balance: [correction] is what
   * auto did beyond the model at [kelvin], and it's kept for every manual value.
   */
  data class Anchor(val kelvin: Double, val correction: Gains)

  fun anchor(autoGains: Gains, ccm: DoubleArray): Anchor {
    val kelvin = estimateKelvin(autoGains, ccm)
    val model = modelGains(kelvin, ccm)
    val auto = autoGains.normalized()
    return Anchor(kelvin, Gains(auto.r / model.r, 1.0, auto.b / model.b))
  }

  /** Manual gains for [kelvin] and [tint] (-1…1, positive = magenta). */
  fun manualGains(kelvin: Double, tint: Double, ccm: DoubleArray, anchor: Anchor?): Gains {
    val model = modelGains(kelvin.coerceIn(MIN_KELVIN, MAX_KELVIN), ccm)
    val c = anchor?.correction ?: Gains(1.0, 1.0, 1.0)
    // Less green gain = more magenta. Expressed by scaling red/blue up instead,
    // so green stays at 1 (Camera2 expects gains ≥ 1).
    val greenScale = 1.0 + 0.25 * tint.coerceIn(-1.0, 1.0)
    val r = model.r * c.r * greenScale
    val b = model.b * c.b * greenScale
    // Keep every gain ≥ 1 (some HALs reject gains below 1).
    val lowest = minOf(r, 1.0, b)
    return Gains(r / lowest, 1.0 / lowest, b / lowest)
  }

  /** Nearest Camera2 AWB preset for a temperature, for phones without manual gains. */
  enum class Preset(val kelvin: Double) {
    INCANDESCENT(2850.0),
    WARM_FLUORESCENT(3000.0),
    FLUORESCENT(4000.0),
    DAYLIGHT(5500.0),
    CLOUDY_DAYLIGHT(6500.0),
    SHADE(7500.0),
  }

  fun nearestPreset(kelvin: Double, available: Collection<Preset>): Preset? =
    available.minByOrNull { abs(ln(it.kelvin) - ln(kelvin)) }

  // ---------- 3×3 helpers ----------

  val IDENTITY = doubleArrayOf(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)

  fun multiply3(m: DoubleArray, v: DoubleArray) = doubleArrayOf(
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  )

  fun invert3(m: DoubleArray): DoubleArray? {
    val det = m[0] * (m[4] * m[8] - m[5] * m[7]) -
      m[1] * (m[3] * m[8] - m[5] * m[6]) +
      m[2] * (m[3] * m[7] - m[4] * m[6])
    if (abs(det) < 1e-9) return null
    val d = 1 / det
    return doubleArrayOf(
      (m[4] * m[8] - m[5] * m[7]) * d,
      (m[2] * m[7] - m[1] * m[8]) * d,
      (m[1] * m[5] - m[2] * m[4]) * d,
      (m[5] * m[6] - m[3] * m[8]) * d,
      (m[0] * m[8] - m[2] * m[6]) * d,
      (m[2] * m[3] - m[0] * m[5]) * d,
      (m[3] * m[7] - m[4] * m[6]) * d,
      (m[1] * m[6] - m[0] * m[7]) * d,
      (m[0] * m[4] - m[1] * m[3]) * d,
    )
  }

  private fun sq(v: Double) = v * v
}
