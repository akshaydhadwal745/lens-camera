package expo.modules.lenscamera.imaging

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Best group photo, the pixel work (docs/design/switch-features.md §5; prototype and
 * test: research/groupshot/groupshot.py). Everything here is plain arrays so it's
 * unit-tested on the JVM (GroupShotMathTest). Images are planar float RGB 0–255,
 * row-major, `w × h`.
 */
object GroupShotMath {
  class Rgb(val w: Int, val h: Int, val r: FloatArray = FloatArray(w * h), val g: FloatArray = FloatArray(w * h), val b: FloatArray = FloatArray(w * h)) {
    fun luma(): FloatArray = FloatArray(w * h) { 0.299f * r[it] + 0.587f * g[it] + 0.114f * b[it] }

    companion object {
      fun fromArgb(px: IntArray, w: Int, h: Int): Rgb {
        val out = Rgb(w, h)
        for (i in px.indices) {
          val c = px[i]
          out.r[i] = ((c shr 16) and 0xFF).toFloat()
          out.g[i] = ((c shr 8) and 0xFF).toFloat()
          out.b[i] = (c and 0xFF).toFloat()
        }
        return out
      }
    }

    fun toArgb(): IntArray = IntArray(w * h) {
      val rr = r[it].roundToInt().coerceIn(0, 255)
      val gg = g[it].roundToInt().coerceIn(0, 255)
      val bb = b[it].roundToInt().coerceIn(0, 255)
      (0xFF shl 24) or (rr shl 16) or (gg shl 8) or bb
    }
  }

  /** Crop pixel (x, y) ↔ source pixel: rotate by `deg` about the crop centre, then shift by (dx, dy). */
  data class Motion(val deg: Double, val dx: Double, val dy: Double)

  /** Bilinear sample with edges clamped. */
  fun sample(src: FloatArray, w: Int, h: Int, x: Double, y: Double): Float {
    val xc = x.coerceIn(0.0, w - 1.0)
    val yc = y.coerceIn(0.0, h - 1.0)
    val x0 = xc.toInt()
    val y0 = yc.toInt()
    val x1 = min(x0 + 1, w - 1)
    val y1 = min(y0 + 1, h - 1)
    val fx = (xc - x0).toFloat()
    val fy = (yc - y0).toFloat()
    val top = src[y0 * w + x0] * (1 - fx) + src[y0 * w + x1] * fx
    val bottom = src[y1 * w + x0] * (1 - fx) + src[y1 * w + x1] * fx
    return top * (1 - fy) + bottom * fy
  }

  /** `src` (same size as the crop) moved by `m` into crop coordinates. */
  fun warp(src: FloatArray, w: Int, h: Int, m: Motion): FloatArray {
    val cx = w / 2.0
    val cy = h / 2.0
    val rad = Math.toRadians(m.deg)
    val c = cos(rad)
    val s = sin(rad)
    val out = FloatArray(w * h)
    for (y in 0 until h) {
      for (x in 0 until w) {
        val ux = x - cx
        val uy = y - cy
        out[y * w + x] = sample(src, w, h, c * ux - s * uy + cx + m.dx, s * ux + c * uy + cy + m.dy)
      }
    }
    return out
  }

  fun warp(src: Rgb, m: Motion) = Rgb(src.w, src.h, warp(src.r, src.w, src.h, m), warp(src.g, src.w, src.h, m), warp(src.b, src.w, src.h, m))

  private fun cost(tmpl: FloatArray, src: FloatArray, use: BooleanArray, w: Int, h: Int, m: Motion, step: Int): Double {
    val cx = w / 2.0
    val cy = h / 2.0
    val rad = Math.toRadians(m.deg)
    val c = cos(rad)
    val s = sin(rad)
    var sum = 0.0
    var n = 0
    var y = 0
    while (y < h) {
      var x = 0
      while (x < w) {
        val i = y * w + x
        if (use[i]) {
          val ux = x - cx
          val uy = y - cy
          sum += abs(sample(src, w, h, c * ux - s * uy + cx + m.dx, s * ux + c * uy + cy + m.dy) - tmpl[i])
          n++
        }
        x += step
      }
      y += step
    }
    return if (n == 0) Double.MAX_VALUE else sum / n
  }

  /**
   * Rotation (±3°, 0.5° steps) × translation (±8 px) with the least mean |difference|
   * on `use` (the eye band left out: it's what differs), then ±1 px refinement and a
   * parabolic sub-pixel fit. `src` is the donor already moved into the crop by the
   * landmark offset, so only the small leftover motion is searched.
   */
  fun align(tmpl: FloatArray, src: FloatArray, use: BooleanArray, w: Int, h: Int): Motion {
    var best = Motion(0.0, 0.0, 0.0)
    var bestCost = Double.MAX_VALUE
    var a = -3.0
    while (a <= 3.0001) {
      for (dy in -8..8 step 2) {
        for (dx in -8..8 step 2) {
          val m = Motion(a, dx.toDouble(), dy.toDouble())
          val v = cost(tmpl, src, use, w, h, m, 2)
          if (v < bestCost) {
            bestCost = v
            best = m
          }
        }
      }
      a += 0.5
    }
    repeat(2) {
      best = (-1..1).map { k -> best.copy(dx = best.dx + k) }.minBy { cost(tmpl, src, use, w, h, it, 1) }
      best = (-1..1).map { k -> best.copy(dy = best.dy + k) }.minBy { cost(tmpl, src, use, w, h, it, 1) }
    }
    fun parabola(v: List<Double>): Double {
      val den = v[0] - 2 * v[1] + v[2]
      return if (den <= 0) 0.0 else (0.5 * (v[0] - v[2]) / den).coerceIn(-0.5, 0.5)
    }
    val fx = parabola((-1..1).map { k -> cost(tmpl, src, use, w, h, best.copy(dx = best.dx + k), 1) })
    val fy = parabola((-1..1).map { k -> cost(tmpl, src, use, w, h, best.copy(dy = best.dy + k), 1) })
    return best.copy(dx = best.dx + fx, dy = best.dy + fy)
  }

  /** Pearson correlation of two images over `mask` (the ring around the face). 1 = same content. */
  fun ncc(a: FloatArray, b: FloatArray, mask: BooleanArray): Double {
    var n = 0
    var sa = 0.0
    var sb = 0.0
    for (i in a.indices) if (mask[i]) {
      sa += a[i]; sb += b[i]; n++
    }
    if (n < 16) return 0.0
    val ma = sa / n
    val mb = sb / n
    var cov = 0.0
    var va = 0.0
    var vb = 0.0
    for (i in a.indices) if (mask[i]) {
      val da = a[i] - ma
      val db = b[i] - mb
      cov += da * db; va += da * da; vb += db * db
    }
    if (va < 1.0 * n || vb < 1.0 * n) return 1.0 // flat both: nothing to disagree about
    return cov / sqrt(va * vb)
  }

  /** Filled ellipse mask (centre, half-axes, angle in degrees). */
  fun ellipse(w: Int, h: Int, cx: Double, cy: Double, ax: Double, ay: Double, deg: Double): FloatArray {
    val rad = Math.toRadians(deg)
    val c = cos(rad)
    val s = sin(rad)
    return FloatArray(w * h) { i ->
      val x = i % w - cx
      val y = i / w - cy
      val u = (c * x + s * y) / ax
      val v = (-s * x + c * y) / ay
      if (u * u + v * v <= 1.0) 1f else 0f
    }
  }

  /** Gaussian blur (three box passes ≈ Gaussian of `sigma`), separable, edges clamped. */
  fun blur(src: FloatArray, w: Int, h: Int, sigma: Double): FloatArray {
    val r = max(1, (sqrt(12 * sigma * sigma / 3 + 1) / 2).toInt())
    var cur = src.copyOf()
    val tmp = FloatArray(w * h)
    repeat(3) {
      for (y in 0 until h) {
        var acc = 0f
        for (k in -r..r) acc += cur[y * w + k.coerceIn(0, w - 1)]
        for (x in 0 until w) {
          tmp[y * w + x] = acc / (2 * r + 1)
          acc += cur[y * w + (x + r + 1).coerceAtMost(w - 1)] - cur[y * w + (x - r).coerceAtLeast(0)]
        }
      }
      for (x in 0 until w) {
        var acc = 0f
        for (k in -r..r) acc += tmp[k.coerceIn(0, h - 1) * w + x]
        for (y in 0 until h) {
          cur[y * w + x] = acc / (2 * r + 1)
          acc += tmp[(y + r + 1).coerceAtMost(h - 1) * w + x] - tmp[(y - r).coerceAtLeast(0) * w + x]
        }
      }
    }
    return cur
  }

  // ---------- Colour: match the donor to the base on the skin around the face (CIE Lab) ----------

  private fun lin(c: Float): Double {
    val v = c / 255.0
    return if (v <= 0.04045) v / 12.92 else ((v + 0.055) / 1.055).pow(2.4)
  }

  private fun gam(v: Double): Float = (if (v <= 0.0031308) 12.92 * v else 1.055 * v.pow(1 / 2.4) - 0.055).times(255).toFloat()

  private fun f(t: Double) = if (t > 0.008856) t.pow(1.0 / 3) else 7.787 * t + 16.0 / 116
  private fun fi(t: Double) = if (t > 0.206893) t * t * t else (t - 16.0 / 116) / 7.787

  fun toLab(img: Rgb): Array<FloatArray> {
    val l = FloatArray(img.w * img.h)
    val a = FloatArray(img.w * img.h)
    val b = FloatArray(img.w * img.h)
    for (i in l.indices) {
      val r = lin(img.r[i]); val g = lin(img.g[i]); val bl = lin(img.b[i])
      val x = f((0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.95047)
      val y = f(0.2126 * r + 0.7152 * g + 0.0722 * bl)
      val z = f((0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.08883)
      l[i] = (116 * y - 16).toFloat(); a[i] = (500 * (x - y)).toFloat(); b[i] = (200 * (y - z)).toFloat()
    }
    return arrayOf(l, a, b)
  }

  fun fromLab(lab: Array<FloatArray>, w: Int, h: Int): Rgb {
    val out = Rgb(w, h)
    for (i in 0 until w * h) {
      val y = (lab[0][i] + 16) / 116.0
      val x = lab[1][i] / 500.0 + y
      val z = y - lab[2][i] / 200.0
      val xx = fi(x) * 0.95047; val yy = fi(y); val zz = fi(z) * 1.08883
      out.r[i] = gam(3.2406 * xx - 1.5372 * yy - 0.4986 * zz).coerceIn(0f, 255f)
      out.g[i] = gam(-0.9689 * xx + 1.8758 * yy + 0.0415 * zz).coerceIn(0f, 255f)
      out.b[i] = gam(0.0557 * xx - 0.2040 * yy + 1.0570 * zz).coerceIn(0f, 255f)
    }
    return out
  }

  /** Donor recoloured so its ring statistics match the base's (mean exactly, contrast half-way). */
  fun matchColour(base: Rgb, donor: Rgb, ring: BooleanArray): Rgb {
    val lb = toLab(base)
    val ld = toLab(donor)
    for (c in 0 until 3) {
      var n = 0; var mb = 0.0; var md = 0.0
      for (i in ring.indices) if (ring[i]) { mb += lb[c][i]; md += ld[c][i]; n++ }
      if (n == 0) continue
      mb /= n; md /= n
      var vb = 0.0; var vd = 0.0
      for (i in ring.indices) if (ring[i]) { vb += (lb[c][i] - mb).pow(2); vd += (ld[c][i] - md).pow(2) }
      val k = sqrt((sqrt(vb / n) + 1e-3) / (sqrt(vd / n) + 1e-3))
      for (i in ld[c].indices) ld[c][i] = ((ld[c][i] - md) * k + mb).toFloat()
    }
    return fromLab(ld, donor.w, donor.h)
  }

  // ---------- Multi-band blend ----------

  private fun down(src: FloatArray, w: Int, h: Int): Triple<FloatArray, Int, Int> {
    val bl = blur(src, w, h, 1.0)
    val nw = (w + 1) / 2
    val nh = (h + 1) / 2
    return Triple(FloatArray(nw * nh) { bl[min(h - 1, (it / nw) * 2) * w + min(w - 1, (it % nw) * 2)] }, nw, nh)
  }

  private fun up(src: FloatArray, w: Int, h: Int, tw: Int, th: Int): FloatArray =
    FloatArray(tw * th) { i -> sample(src, w, h, (i % tw) / 2.0, (i / tw) / 2.0) }

  /** One channel: mask 1 = take `b`. Laplacian pyramid, `levels` deep: no visible seam. */
  fun blend(a: FloatArray, b: FloatArray, mask: FloatArray, w: Int, h: Int, levels: Int = 4): FloatArray {
    if (levels == 0 || w < 8 || h < 8) return FloatArray(w * h) { a[it] * (1 - mask[it]) + b[it] * mask[it] }
    val (da, nw, nh) = down(a, w, h)
    val (db, _, _) = down(b, w, h)
    val (dm, _, _) = down(mask, w, h)
    val low = blend(da, db, dm, nw, nh, levels - 1)
    val ua = up(da, nw, nh, w, h)
    val ub = up(db, nw, nh, w, h)
    val ul = up(low, nw, nh, w, h)
    return FloatArray(w * h) { i -> ul[i] + (a[i] - ua[i]) * (1 - mask[i]) + (b[i] - ub[i]) * mask[i] }
  }

  fun blend(a: Rgb, b: Rgb, mask: FloatArray) = Rgb(a.w, a.h, blend(a.r, b.r, mask, a.w, a.h), blend(a.g, b.g, mask, a.w, a.h), blend(a.b, b.b, mask, a.w, a.h))

  /** PSNR (dB) between two images over all pixels (tests). */
  fun psnr(a: Rgb, b: Rgb): Double {
    var se = 0.0
    for (i in a.r.indices) se += (a.r[i] - b.r[i]).toDouble().pow(2) + (a.g[i] - b.g[i]).toDouble().pow(2) + (a.b[i] - b.b[i]).toDouble().pow(2)
    val mse = se / (3.0 * a.r.size)
    return if (mse == 0.0) 99.0 else 10 * kotlin.math.log10(255.0 * 255.0 / mse)
  }
}
