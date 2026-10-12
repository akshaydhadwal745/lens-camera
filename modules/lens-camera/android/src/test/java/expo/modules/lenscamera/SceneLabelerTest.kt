package expo.modules.lenscamera

import expo.modules.lenscamera.gl.SceneLabeler
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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

  private fun frame(w: Int, h: Int, luma: (Int, Int) -> Int): ByteArray {
    val out = ByteArray(w * h * 4)
    for (y in 0 until h) for (x in 0 until w) {
      val v = luma(x, y).coerceIn(0, 255).toByte()
      val i = (y * w + x) * 4
      out[i] = v; out[i + 1] = v; out[i + 2] = v; out[i + 3] = -1
    }
    return out
  }

  @Test
  fun darkOrFlatFramesAreNotLabelled() {
    assertFalse(SceneLabeler.recognisable(frame(64, 48) { _, _ -> 6 }))             // black box (Device Farm rack)
    assertFalse(SceneLabeler.recognisable(frame(64, 48) { x, _ -> 10 + x % 3 }))    // dark + noise only
    assertFalse(SceneLabeler.recognisable(frame(64, 48) { _, _ -> 140 }))           // flat grey (covered lens)
    assertTrue(SceneLabeler.recognisable(frame(64, 48) { x, y -> (x * 4 + y * 2) % 256 }))       // a lit scene
    assertTrue(SceneLabeler.recognisable(frame(64, 48) { x, y -> if ((x / 8 + y / 8) % 5 == 0) 220 else 8 })) // city lights at night
    assertFalse(SceneLabeler.recognisable(ByteArray(0)))
  }
}
