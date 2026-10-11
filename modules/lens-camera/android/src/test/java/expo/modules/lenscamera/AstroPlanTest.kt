package expo.modules.lenscamera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AstroPlanTest {
  @Test
  fun darkSkyGetsLongFramesAtModestIso() {
    // Auto exposure in a dark field: ISO 3200 at 1/10 s. Camera allows 0.1 ms … 10 s, ISO 50–3200.
    val plan = CameraController.planAstro(3200, 100_000_000L, 50, 3200, 10_000_000_000L)!!
    assertEquals(4_000_000_000L, plan["exposureNs"])          // capped at 4 s
    assertEquals(160, plan["iso"])                              // 2× the light over 4 s → ISO 160
    assertEquals(4, plan["frames"])                             // 16 s total
    assertEquals(16.0, plan["seconds"] as Double, 0.01)
  }

  @Test
  fun veryDarkCapsIsoAt800() {
    // ISO 6400 at 1/2 s: needs ISO 1600 at 4 s → capped at 800 (stacking makes up the rest).
    val plan = CameraController.planAstro(6400, 500_000_000L, 50, 6400, 30_000_000_000L)!!
    assertEquals(800, plan["iso"])
    assertEquals(4_000_000_000L, plan["exposureNs"])
  }

  @Test
  fun littleLightUsesShorterFrames() {
    // ISO 1600 at 1/15 s, lowest ISO 100: 4 s at ISO 100 would be ~2× too bright → shorter frames, more of them.
    val plan = CameraController.planAstro(1600, 66_666_666L, 100, 3200, 10_000_000_000L)!!
    assertEquals(100, plan["iso"])
    assertTrue((plan["exposureNs"] as Long) in 500_000_000L..4_000_000_000L)
    assertTrue((plan["frames"] as Int) in 4..12)
  }

  @Test
  fun shortMaxExposureMeansNoAstro() {
    // A camera that stops at 1/8 s can't do long exposures: plain Night instead.
    assertNull(CameraController.planAstro(3200, 100_000_000L, 50, 3200, 125_000_000L))
  }
}
