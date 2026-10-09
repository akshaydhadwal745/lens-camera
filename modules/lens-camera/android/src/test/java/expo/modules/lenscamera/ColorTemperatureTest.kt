package expo.modules.lenscamera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ColorTemperatureTest {
  // A typical phone CCM (sensor -> sRGB), rows sum to ~1.
  private val ccm = doubleArrayOf(
    1.71, -0.55, -0.16,
    -0.27, 1.52, -0.25,
    0.02, -0.68, 1.66,
  )

  @Test
  fun warmLightNeedsMoreBlueGain() {
    val warm = ColorTemperature.modelGains(3000.0)
    val cool = ColorTemperature.modelGains(8000.0)
    assertTrue(warm.b > cool.b)
    assertTrue(warm.r < cool.r)
  }

  @Test
  fun d65IsNeutralWithIdentityMatrix() {
    val g = ColorTemperature.modelGains(6504.0)
    assertEquals(1.0, g.r, 0.01)
    assertEquals(1.0, g.b, 0.01)
  }

  @Test
  fun estimateRoundTrips() {
    for (k in listOf(2500.0, 3200.0, 4000.0, 5500.0, 6500.0, 8000.0)) {
      val gains = ColorTemperature.modelGains(k, ccm)
      val estimate = ColorTemperature.estimateKelvin(gains, ccm)
      assertEquals("round trip at $k", k, estimate, k * 0.02)
    }
  }

  @Test
  fun anchoredManualMatchesAutoAtItsOwnTemperature() {
    // Auto did something slightly off-model (a green-ish correction).
    val auto = ColorTemperature.Gains(2.05, 1.0, 1.62)
    val anchor = ColorTemperature.anchor(auto, ccm)
    val manual = ColorTemperature.manualGains(anchor.kelvin, 0.0, ccm, anchor)
    assertEquals(auto.r / auto.g, manual.r / manual.g, 0.01)
    assertEquals(auto.b / auto.g, manual.b / manual.g, 0.01)
  }

  @Test
  fun manualGainsNeverBelowOne() {
    for (k in listOf(2000.0, 5000.0, 10000.0)) {
      for (tint in listOf(-1.0, 0.0, 1.0)) {
        val g = ColorTemperature.manualGains(k, tint, ccm, null)
        assertTrue(g.r >= 0.999 && g.g >= 0.999 && g.b >= 0.999)
      }
    }
  }

  @Test
  fun positiveTintIsMagenta() {
    val neutral = ColorTemperature.manualGains(5500.0, 0.0, ccm, null)
    val magenta = ColorTemperature.manualGains(5500.0, 1.0, ccm, null)
    // Relative to red/blue, green gets less gain.
    assertTrue(magenta.g / magenta.r < neutral.g / neutral.r)
  }

  @Test
  fun presetSnapping() {
    val all = ColorTemperature.Preset.values().toList()
    assertEquals(ColorTemperature.Preset.INCANDESCENT, ColorTemperature.nearestPreset(2600.0, all))
    assertEquals(ColorTemperature.Preset.DAYLIGHT, ColorTemperature.nearestPreset(5300.0, all))
    assertEquals(ColorTemperature.Preset.SHADE, ColorTemperature.nearestPreset(9500.0, all))
    assertEquals(
      ColorTemperature.Preset.DAYLIGHT,
      ColorTemperature.nearestPreset(9500.0, listOf(ColorTemperature.Preset.DAYLIGHT, ColorTemperature.Preset.INCANDESCENT)),
    )
  }
}
