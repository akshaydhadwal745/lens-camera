package expo.modules.lenscamera

import expo.modules.lenscamera.imaging.BurstPicker
import org.junit.Assert.assertTrue
import org.junit.Test

class BurstPickerTest {
  private val w = 64
  private val h = 64

  /** A checkerboard (sharp) and the same board box-blurred (shaky/out of focus). */
  private fun board(): FloatArray = FloatArray(w * h) { i -> if (((i % w) / 4 + (i / w) / 4) % 2 == 0) 220f else 30f }

  private fun blurred(src: FloatArray, r: Int): FloatArray = FloatArray(w * h) { i ->
    val x = i % w
    val y = i / w
    var s = 0f
    var n = 0
    for (dy in -r..r) for (dx in -r..r) {
      val xx = (x + dx).coerceIn(0, w - 1)
      val yy = (y + dy).coerceIn(0, h - 1)
      s += src[yy * w + xx]
      n++
    }
    s / n
  }

  @Test
  fun sharperShotScoresHigher() {
    val sharp = BurstPicker.laplacianVariance(board(), w, h)
    val soft = BurstPicker.laplacianVariance(blurred(board(), 1), w, h)
    val softer = BurstPicker.laplacianVariance(blurred(board(), 2), w, h)
    assertTrue("sharp $sharp > soft $soft > softer $softer", sharp > soft && soft > softer)
  }
}
