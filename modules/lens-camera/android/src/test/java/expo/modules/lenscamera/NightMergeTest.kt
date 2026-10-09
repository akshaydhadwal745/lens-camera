package expo.modules.lenscamera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

class NightMergeTest {
  private val w = 200
  private val h = 150

  private fun scene(seed: Int): IntArray {
    // Smooth blobs + texture, like a real scene (pure noise is too easy).
    val r = Random(seed)
    val base = IntArray(w * h)
    repeat(30) {
      val cx = r.nextInt(w)
      val cy = r.nextInt(h)
      val rad = 5 + r.nextInt(25)
      val v = r.nextInt(256)
      for (y in 0 until h) for (x in 0 until w) {
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) < rad * rad) base[y * w + x] = v
      }
    }
    return base
  }

  private fun shifted(src: IntArray, dx: Int, dy: Int): IntArray =
    IntArray(w * h) { i ->
      val x = i % w - dx
      val y = i / w - dy
      if (x in 0 until w && y in 0 until h) src[y * w + x] else 0
    }

  @Test
  fun findsTheShift() {
    val ref = scene(1)
    for ((dx, dy) in listOf(0 to 0, 3 to -2, -7 to 5, 11 to 9)) {
      // frame(x+dx, y+dy) == ref(x, y)
      val frame = shifted(ref, dx, dy)
      assertEquals(dx to dy, NightMerge.align(ref, frame, w, h))
    }
  }

  @Test
  fun blurredFrameIsLessSharp() {
    val sharp = scene(2)
    val blurred = IntArray(w * h) { i ->
      val x = i % w
      if (x in 1 until w - 1) (sharp[i - 1] + sharp[i] + sharp[i + 1]) / 3 else sharp[i]
    }
    assertTrue(NightMerge.sharpness(sharp, w, h) > NightMerge.sharpness(blurred, w, h))
  }

  @Test
  fun darkScenesAreLiftedBrightOnesAreNot() {
    assertTrue(NightMerge.shadowLift(IntArray(1000) { 30 }) < 1.0)
    assertEquals(1.0, NightMerge.shadowLift(IntArray(1000) { 140 }), 1e-9)
  }
}
