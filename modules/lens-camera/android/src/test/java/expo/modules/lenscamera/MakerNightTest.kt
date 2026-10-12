package expo.modules.lenscamera

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MakerNightTest {
  @Test
  fun pixel8aNightAt5MpLosesToLensNight() {
    // Device Farm dev-68: Google's Night extension saved 1920×2560 of the 4624×3472 camera.
    assertFalse(CameraController.makerNightBigEnough(1920, 2560, 4624, 3472))
  }

  @Test
  fun fullSizeMakerNightIsKept() {
    // Galaxy S25 Ultra: Samsung's Night extension saved the full 4080×3060.
    assertTrue(CameraController.makerNightBigEnough(3060, 4080, 4080, 3060))
    // Exactly half still counts.
    assertTrue(CameraController.makerNightBigEnough(2000, 1500, 4000, 1500))
  }

  @Test
  fun unknownSizesKeepTheMakerMode() {
    assertTrue(CameraController.makerNightBigEnough(0, 0, 4000, 3000))
    assertTrue(CameraController.makerNightBigEnough(4000, 3000, 0, 0))
  }
}
