package expo.modules.lenscamera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LookLutTest {
  private val grey = doubleArrayOf(0.5, 0.5, 0.5)
  private val skin = doubleArrayOf(0.85, 0.62, 0.5)

  @Test
  fun everyLookStaysInRange() {
    for (id in LookLut.IDS) {
      for (r in 0..4) for (g in 0..4) for (b in 0..4) {
        val o = LookLut.apply(id, doubleArrayOf(r / 4.0, g / 4.0, b / 4.0))
        assertTrue("$id out of range", o.all { it in 0.0..1.0 })
      }
    }
  }

  @Test
  fun blackAndWhiteHaveNoColour() {
    for (id in listOf("bw", "noir")) {
      val o = LookLut.apply(id, skin)
      assertEquals(o[0], o[1], 1e-9)
      assertEquals(o[1], o[2], 1e-9)
    }
  }

  @Test
  fun warmIsWarmerCoolIsCooler() {
    val warm = LookLut.apply("warm", grey)
    val cool = LookLut.apply("cool", grey)
    assertTrue(warm[0] > warm[2])
    assertTrue(cool[2] > cool[0])
  }

  @Test
  fun unknownLookIsIdentity() {
    val o = LookLut.apply("nope", skin)
    for (i in 0..2) assertEquals(skin[i], o[i], 1e-9)
  }

  @Test
  fun splineHitsItsPoints() {
    val s = LookLut.Spline(listOf(0.0 to 0.06, 0.25 to 0.24, 0.5 to 0.52, 0.75 to 0.79, 1.0 to 0.96))
    assertEquals(0.06, s(0.0), 1e-9)
    assertEquals(0.52, s(0.5), 1e-9)
    assertEquals(0.96, s(1.0), 1e-9)
  }

  @Test
  fun stripLayout() {
    val strip = LookLut.bakeStrip("cool")
    val n = LookLut.SIZE
    assertEquals(n * n * n * 4, strip.size)
    // Pure white input (r=g=b=n-1): row n-1, column (n-1)·n + n-1.
    val i = (((n - 1) * n * n) + (n - 1) * n + (n - 1)) * 4
    val expected = LookLut.apply("cool", doubleArrayOf(1.0, 1.0, 1.0))
    assertEquals((expected[2] * 255 + 0.5).toInt(), strip[i + 2].toInt() and 0xFF)
  }

  @Test
  fun gammaRoundTrip() {
    for (v in listOf(0.0, 0.02, 0.2, 0.5, 0.9, 1.0)) {
      assertEquals(v, LookLut.toGamma(LookLut.toLinear(v)), 1e-9)
    }
  }
}
