package expo.modules.lenscamera

import expo.modules.lenscamera.imaging.Portrait
import expo.modules.lenscamera.imaging.PortraitStyle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class PortraitRefineTest {
  /**
   * The real case: the model's mask is low-res, so scaled up it is soft (here a
   * 16 px ramp) and a little off (2 px). Refined against a photo with a sharp edge
   * at x = 40, the mask's edge moves toward 40 and gets much steeper.
   * (A guided filter sharpens and nudges; it can't move an edge by many pixels.)
   */
  @Test
  fun guidedFilterSharpensASoftMaskOntoThePhotosEdge() {
    val w = 100
    val h = 20
    val photo = FloatArray(w * h) { if (it % w < 40) 0.9f else 0.1f }
    val coarse = FloatArray(w * h) { i -> (1f - ((i % w) - 34f) / 16f).coerceIn(0f, 1f) } // 0.5 at x = 42
    val refined = Portrait.guidedFilter(photo, coarse, w, h, radius = 8, eps = 1e-3f)
    val row = 10 * w
    fun edge(m: FloatArray) = (0 until w).first { m[row + it] < 0.5f }
    assertTrue("refined edge ${edge(refined)} closer to 40 than coarse ${edge(coarse)}", abs(edge(refined) - 40) < abs(edge(coarse) - 40))
    // Steeper across the true edge (38 → 42): at least twice the coarse ramp's drop.
    val drop = refined[row + 38] - refined[row + 42]
    val coarseDrop = coarse[row + 38] - coarse[row + 42]
    assertTrue("drop $drop vs coarse $coarseDrop", drop > 2 * coarseDrop)
  }

  @Test
  fun blurFractionMapping() {
    assertEquals(0.024f, PortraitStyle.blurFraction(1.4), 1e-6f)
    assertEquals(0f, PortraitStyle.blurFraction(16.0), 1e-6f)
    assertEquals(0f, PortraitStyle.blurFraction(null), 0f)
    assertTrue(PortraitStyle.blurFraction(2.8) in 0.021f..0.022f)
  }

  @Test
  fun autoApertureFollowsSubjectSize() {
    assertEquals(1.8, PortraitStyle.autoAperture(0.7), 1e-9) // close-up
    assertEquals(2.8, PortraitStyle.autoAperture(0.30), 1e-9)
    assertEquals(4.0, PortraitStyle.autoAperture(0.12), 1e-9)
    assertEquals(5.6, PortraitStyle.autoAperture(0.02), 1e-9) // far / full body
    // Monotonic: a bigger subject never gets less blur.
    var last = 99.0
    for (k in 0..100) {
      val a = PortraitStyle.autoAperture(k / 100.0)
      assertTrue(a <= last + 1e-9)
      last = a
    }
  }
}
