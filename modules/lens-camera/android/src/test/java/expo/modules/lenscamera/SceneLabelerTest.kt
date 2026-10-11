package expo.modules.lenscamera

import expo.modules.lenscamera.gl.SceneLabeler
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SceneLabelerTest {
  @Test
  fun scenesMapToLooks() {
    assertEquals("golden", SceneLabeler.lookFor(listOf("sky", "sunset")))      // most specific wins over "sky"
    assertEquals("warm", SceneLabeler.lookFor(listOf("food", "tableware")))
    assertEquals("cool", SceneLabeler.lookFor(listOf("snow", "mountain")))
    assertEquals("cinematic", SceneLabeler.lookFor(listOf("night", "building")))
    assertEquals("vivid", SceneLabeler.lookFor(listOf("flower")))
    assertNull(SceneLabeler.lookFor(listOf("desk", "computer")))              // nothing fits: no suggestion
    assertNull(SceneLabeler.lookFor(emptyList()))
  }
}
