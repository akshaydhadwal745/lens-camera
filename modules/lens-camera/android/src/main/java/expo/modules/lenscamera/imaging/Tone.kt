package expo.modules.lenscamera.imaging

import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min

/**
 * Whole-image tone analysis from a small copy of the photo (~256 px):
 *  - "Auto" enhance: black/white points, mid-tone gamma and a little vibrance
 *    (the same idea as Core Image's auto-adjust filters on iOS);
 *  - a blurred luminance "base" so Highlights/Shadows can lift or recover by
 *    region (local tone mapping) instead of flattening the whole image.
 *
 * Pure Kotlin (ARGB ints in, numbers out) so it can be unit tested on the JVM.
 */
object Tone {
  data class Auto(val black: Double, val white: Double, val gamma: Double, val vibrance: Double) {
    companion object {
      val NEUTRAL = Auto(0.0, 1.0, 1.0, 0.0)
    }
  }

  fun luma(argb: Int): Double {
    val r = (argb shr 16 and 0xFF) / 255.0
    val g = (argb shr 8 and 0xFF) / 255.0
    val b = (argb and 0xFF) / 255.0
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }

  fun auto(pixels: IntArray): Auto {
    if (pixels.isEmpty()) return Auto.NEUTRAL
    val bins = IntArray(256)
    for (p in pixels) bins[(luma(p) * 255).toInt().coerceIn(0, 255)]++
    val n = pixels.size
    fun percentile(q: Double): Double {
      val target = q * n
      var sum = 0
      for (i in 0 until 256) {
        sum += bins[i]
        if (sum >= target) return i / 255.0
      }
      return 1.0
    }
    // Gentle: never clip more than a sliver, never stretch a low-key/high-key
    // scene into something it isn't.
    val black = min(percentile(0.005), 0.08)
    val white = max(percentile(0.995), 0.85)
    val median = percentile(0.5)
    val stretched = ((median - black) / (white - black)).coerceIn(0.05, 0.95)
    val gamma = (ln(0.46) / ln(stretched)).coerceIn(0.75, 1.3)
    return Auto(black, white, gamma, 0.15)
  }

  /**
   * Blurred luminance of a w×h image, as bytes (0…255), for the shadows/
   * highlights base layer. Two box blurs ≈ a Gaussian, radius ~1/12 of the width.
   */
  fun base(pixels: IntArray, w: Int, h: Int): ByteArray {
    val l = DoubleArray(w * h) { luma(pixels[it]) }
    val r = max(1, max(w, h) / 12)
    val a = boxBlur(boxBlur(l, w, h, r), w, h, r)
    return ByteArray(w * h) { (a[it] * 255 + 0.5).toInt().coerceIn(0, 255).toByte() }
  }

  private fun boxBlur(src: DoubleArray, w: Int, h: Int, r: Int): DoubleArray {
    val tmp = DoubleArray(w * h)
    val out = DoubleArray(w * h)
    for (y in 0 until h) {
      for (x in 0 until w) {
        var sum = 0.0
        var count = 0
        for (k in -r..r) {
          val xx = x + k
          if (xx in 0 until w) {
            sum += src[y * w + xx]
            count++
          }
        }
        tmp[y * w + x] = sum / count
      }
    }
    for (x in 0 until w) {
      for (y in 0 until h) {
        var sum = 0.0
        var count = 0
        for (k in -r..r) {
          val yy = y + k
          if (yy in 0 until h) {
            sum += tmp[yy * w + x]
            count++
          }
        }
        out[y * w + x] = sum / count
      }
    }
    return out
  }
}
