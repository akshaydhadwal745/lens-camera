package expo.modules.lenscamera

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapRegionDecoder
import android.graphics.Rect
import android.os.Build
import androidx.exifinterface.media.ExifInterface
import java.io.File
import java.io.FileOutputStream
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * Night mode on phones without the maker's own Night mode: several quick
 * shots are aligned and averaged, which cuts noise by about √N (8 frames ≈
 * 3× less noise) while keeping the detail of a short exposure.
 *
 *  1. The sharpest frame becomes the reference (handshake varies per frame).
 *  2. Each other frame's shift is found on a small copy (coarse-to-fine search).
 *  3. Frames are merged in horizontal bands (little memory, any photo size);
 *     pixels that differ a lot from the reference (something moved) are skipped,
 *     so there are no ghosts.
 *  4. A gentle shadow lift, since night scenes come out dark.
 */
object NightMerge {
  private const val BAND = 128

  fun merge(frames: List<File>, output: File): Pair<Int, Int> {
    require(frames.isNotEmpty())
    if (frames.size == 1) {
      frames[0].copyTo(output, overwrite = true)
      val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(output.path, o)
      return o.outWidth to o.outHeight
    }
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(frames[0].path, bounds)
    val w = bounds.outWidth
    val h = bounds.outHeight
    // Very large frames (50 MP+) are merged at half size: noise matters more than pixels at night.
    val sample = if (w.toLong() * h > 24_000_000L) 2 else 1
    val ow = w / sample
    val oh = h / sample

    // Small luma copies for picking the reference and aligning.
    val smallScale = max(1, max(w, h) / 512)
    val smalls = frames.map { smallLuma(it, smallScale) }
    val sw = smalls[0].first
    val sh = smalls[0].second
    val refIndex = smalls.indices.maxByOrNull { sharpness(smalls[it].third, sw, sh) } ?: 0
    val ref = smalls[refIndex].third
    val shifts = smalls.mapIndexed { i, s ->
      if (i == refIndex || s.first != sw || s.second != sh) 0 to 0 else align(ref, s.third, sw, sh)
    }.map { (dx, dy) -> (dx * smallScale / sample) to (dy * smallScale / sample) }

    val decoders = frames.map { regionDecoder(it) }
    val out = Bitmap.createBitmap(ow, oh, Bitmap.Config.ARGB_8888)
    val opts = BitmapFactory.Options().apply {
      inSampleSize = sample
      inPreferredConfig = Bitmap.Config.ARGB_8888
    }
    val order = listOf(refIndex) + frames.indices.filter { it != refIndex }
    // Median-ish brightness for the final lift, measured on the small reference.
    val lift = shadowLift(ref)
    val curve = IntArray(256) { v -> (255 * (v / 255.0).pow(lift)).roundToInt().coerceIn(0, 255) }

    var y = 0
    while (y < oh) {
      val bh = min(BAND, oh - y)
      val sumR = IntArray(ow * bh)
      val sumG = IntArray(ow * bh)
      val sumB = IntArray(ow * bh)
      val count = IntArray(ow * bh)
      var refPixels: IntArray? = null
      for (i in order) {
        val (dx, dy) = shifts[i]
        val pixels = band(decoders[i], frames[i], opts, sample, w, h, y + dy, dx, ow, bh)
        if (refPixels == null) refPixels = pixels
        val rp = refPixels
        for (p in 0 until ow * bh) {
          val c = pixels[p]
          if (c == 0) continue // outside the shifted frame
          if (rp !== pixels) {
            // Deghost: skip pixels that changed (motion) relative to the reference.
            // Per channel, so a colour change at equal brightness counts too.
            val r0 = rp[p]
            val diff = maxOf(
              abs((c shr 16 and 0xFF) - (r0 shr 16 and 0xFF)),
              abs((c shr 8 and 0xFF) - (r0 shr 8 and 0xFF)),
              abs((c and 0xFF) - (r0 and 0xFF)),
            )
            if (diff > 28 + lum(r0) / 8) continue
          }
          sumR[p] += c shr 16 and 0xFF
          sumG[p] += c shr 8 and 0xFF
          sumB[p] += c and 0xFF
          count[p]++
        }
      }
      val row = IntArray(ow * bh)
      for (p in 0 until ow * bh) {
        val n = max(1, count[p])
        row[p] = (0xFF shl 24) or (curve[sumR[p] / n] shl 16) or (curve[sumG[p] / n] shl 8) or curve[sumB[p] / n]
      }
      out.setPixels(row, 0, ow, 0, y, ow, bh)
      y += bh
    }
    decoders.forEach { it?.recycle() }

    FileOutputStream(output).use { out.compress(Bitmap.CompressFormat.JPEG, 95, it) }
    out.recycle()
    copyExif(frames[refIndex], output)
    return ow to oh
  }

  private fun lum(c: Int) = ((c shr 16 and 0xFF) * 54 + (c shr 8 and 0xFF) * 183 + (c and 0xFF) * 19) shr 8

  @Suppress("DEPRECATION")
  private fun regionDecoder(file: File): BitmapRegionDecoder? = runCatching {
    if (Build.VERSION.SDK_INT >= 31) BitmapRegionDecoder.newInstance(file.path) else BitmapRegionDecoder.newInstance(file.path, false)
  }.getOrNull()

  /** One band of a frame, shifted by (dx, dy) in output pixels; 0 = no data. */
  private fun band(
    decoder: BitmapRegionDecoder?,
    file: File,
    opts: BitmapFactory.Options,
    sample: Int,
    w: Int,
    h: Int,
    top: Int,
    dx: Int,
    ow: Int,
    bh: Int,
  ): IntArray {
    val out = IntArray(ow * bh)
    val srcTop = max(0, top)
    val srcBottom = min(h / sample, top + bh)
    if (srcBottom <= srcTop) return out
    val left = max(0, dx)
    val right = min(w / sample, ow + dx)
    if (right <= left) return out
    val rect = Rect(left * sample, srcTop * sample, right * sample, srcBottom * sample)
    val bitmap = (decoder?.decodeRegion(rect, opts) ?: run {
      // No region decoder for this file: decode whole (rare) and crop.
      val all = BitmapFactory.decodeFile(file.path, opts) ?: return out
      Bitmap.createBitmap(all, left, srcTop, right - left, srcBottom - srcTop)
    })
    val bw = min(bitmap.width, right - left)
    val rows = min(bitmap.height, srcBottom - srcTop)
    val tmp = IntArray(bw * rows)
    bitmap.getPixels(tmp, 0, bw, 0, 0, bw, rows)
    bitmap.recycle()
    for (r in 0 until rows) {
      val outRow = (srcTop - top + r) * ow + (left - dx)
      System.arraycopy(tmp, r * bw, out, outRow, min(bw, ow - (left - dx)))
    }
    return out
  }

  /** (width, height, luma bytes) of a small copy. */
  private fun smallLuma(file: File, scale: Int): Triple<Int, Int, IntArray> {
    var sample = 1
    while (sample * 2 <= scale) sample *= 2
    val bitmap = BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })
      ?: return Triple(0, 0, IntArray(0))
    // Normalise to exactly 1/scale so shifts convert back correctly.
    val tw = max(1, bitmap.width * sample / scale)
    val th = max(1, bitmap.height * sample / scale)
    val small = if (bitmap.width != tw) Bitmap.createScaledBitmap(bitmap, tw, th, true) else bitmap
    val px = IntArray(tw * th)
    small.getPixels(px, 0, tw, 0, 0, tw, th)
    if (small !== bitmap) small.recycle()
    bitmap.recycle()
    return Triple(tw, th, IntArray(px.size) { lum(px[it]) })
  }

  /** Sum of squared Laplacian: higher = sharper (less motion blur). */
  internal fun sharpness(l: IntArray, w: Int, h: Int): Double {
    var sum = 0.0
    for (y in 1 until h - 1) for (x in 1 until w - 1) {
      val i = y * w + x
      val lap = 4 * l[i] - l[i - 1] - l[i + 1] - l[i - w] - l[i + w]
      sum += lap.toDouble() * lap
    }
    return sum
  }

  /** Integer shift (dx, dy) that best maps [frame] onto [ref]: coarse then fine. */
  internal fun align(ref: IntArray, frame: IntArray, w: Int, h: Int): Pair<Int, Int> {
    var best = 0 to 0
    for ((step, range) in listOf(4 to 6, 2 to 3, 1 to 2)) {
      var bestCost = Long.MAX_VALUE
      var bestShift = best
      for (dy in -range..range) for (dx in -range..range) {
        val sx = best.first + dx * step
        val sy = best.second + dy * step
        val cost = sad(ref, frame, w, h, sx, sy)
        if (cost < bestCost) {
          bestCost = cost
          bestShift = sx to sy
        }
      }
      best = bestShift
    }
    return best
  }

  /** Mean absolute difference over the central area, frame sampled at (x+dx, y+dy). */
  private fun sad(ref: IntArray, frame: IntArray, w: Int, h: Int, dx: Int, dy: Int): Long {
    val m = 40
    var sum = 0L
    var n = 0
    var y = m
    while (y < h - m) {
      val fy = y + dy
      if (fy in 0 until h) {
        var x = m
        while (x < w - m) {
          val fx = x + dx
          if (fx in 0 until w) {
            sum += abs(ref[y * w + x] - frame[fy * w + fx])
            n++
          }
          x += 2
        }
      }
      y += 2
    }
    return if (n == 0) Long.MAX_VALUE else sum * 1000 / n
  }

  /** Gamma < 1 that brightens a dark scene's mid-tones (1 = unchanged). */
  internal fun shadowLift(luma: IntArray): Double {
    if (luma.isEmpty()) return 1.0
    val sorted = luma.sortedArray()
    val median = max(1, sorted[sorted.size / 2]) / 255.0
    if (median >= 0.35) return 1.0
    // Bring the median toward ~0.35, never more than gamma 0.6.
    return (kotlin.math.ln(0.35) / kotlin.math.ln(median)).coerceIn(0.6, 1.0)
  }

  private fun copyExif(from: File, to: File) {
    runCatching {
      val src = ExifInterface(from)
      val dst = ExifInterface(to)
      for (tag in listOf(
        ExifInterface.TAG_ORIENTATION,
        ExifInterface.TAG_DATETIME_ORIGINAL,
        ExifInterface.TAG_DATETIME,
        ExifInterface.TAG_OFFSET_TIME_ORIGINAL,
        ExifInterface.TAG_MAKE,
        ExifInterface.TAG_MODEL,
        ExifInterface.TAG_F_NUMBER,
        ExifInterface.TAG_FOCAL_LENGTH,
        ExifInterface.TAG_EXPOSURE_TIME,
        ExifInterface.TAG_PHOTOGRAPHIC_SENSITIVITY,
      )) src.getAttribute(tag)?.let { dst.setAttribute(tag, it) }
      dst.saveAttributes()
    }
  }
}
