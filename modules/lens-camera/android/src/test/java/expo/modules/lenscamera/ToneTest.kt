package expo.modules.lenscamera

import expo.modules.lenscamera.imaging.Tone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ToneTest {
  private fun grey(v: Int) = (0xFF shl 24) or (v shl 16) or (v shl 8) or v

  @Test
  fun darkFlatImageGetsBrightened() {
    // Values 20…100 of 255: dull and dark.
    val pixels = IntArray(10_000) { grey(20 + it % 81) }
    val a = Tone.auto(pixels)
    assertTrue(a.white >= 0.85)
    assertTrue("gamma ${a.gamma} should brighten", a.gamma < 1.0)
  }

  @Test
  fun wellExposedImageIsNearlyUntouched() {
    val pixels = IntArray(10_000) { grey((it % 256)) }
    val a = Tone.auto(pixels)
    assertEquals(0.0, a.black, 0.01)
    assertEquals(1.0, a.white, 0.01)
    assertEquals(1.0, a.gamma, 0.15)
  }

  @Test
  fun baseIsBlurred() {
    val w = 64
    val h = 64
    // Left half black, right half white.
    val pixels = IntArray(w * h) { if (it % w < w / 2) grey(0) else grey(255) }
    val base = Tone.base(pixels, w, h)
    val edge = base[32 * w + w / 2].toInt() and 0xFF
    assertTrue("edge $edge should be mid-grey", edge in 80..175)
    assertTrue((base[32 * w + 0].toInt() and 0xFF) < 40)
    assertTrue((base[32 * w + w - 1].toInt() and 0xFF) > 215)
  }
}
