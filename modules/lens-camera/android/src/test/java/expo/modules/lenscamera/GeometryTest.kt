package expo.modules.lenscamera

import expo.modules.lenscamera.imaging.EditRecipe
import expo.modules.lenscamera.imaging.Geometry
import org.junit.Assert.assertEquals
import org.junit.Test

class GeometryTest {
  private fun assertPoint(expected: Pair<Double, Double>, actual: Pair<Double, Double>) {
    assertEquals(expected.first, actual.first, 1e-9)
    assertEquals(expected.second, actual.second, 1e-9)
  }

  @Test
  fun noEditIsIdentity() {
    val g = Geometry(4000, 3000, 1, null)
    assertEquals(4000, g.outputWidth)
    assertEquals(3000, g.outputHeight)
    assertPoint(0.25 to 0.75, g.map(0.25, 0.75))
  }

  @Test
  fun exifRotate90() {
    // Sensor image 4000×3000 stored landscape, shown portrait (EXIF 6).
    val g = Geometry(4000, 3000, 6, null)
    assertEquals(3000, g.outputWidth)
    assertEquals(4000, g.outputHeight)
    // Upright top-left is the stored bottom-left.
    assertPoint(0.0 to 1.0, g.map(0.0, 0.0))
    // Upright top-right is the stored top-left.
    assertPoint(0.0 to 0.0, g.map(1.0, 0.0))
  }

  @Test
  fun exifEveryOrientationKeepsCentre() {
    for (o in 1..8) {
      val g = Geometry(400, 300, o, null)
      assertPoint(0.5 to 0.5, g.map(0.5, 0.5))
    }
  }

  @Test
  fun quarterTurnClockwise() {
    val g = Geometry(400, 300, 1, EditRecipe.Crop(rotate = 1))
    assertEquals(300, g.outputWidth)
    assertEquals(400, g.outputHeight)
    // After a clockwise turn, the top-left shows what was bottom-left.
    assertPoint(0.0 to 1.0, g.map(0.0, 0.0))
  }

  @Test
  fun flipMirrors() {
    val g = Geometry(400, 300, 1, EditRecipe.Crop(flip = true))
    assertPoint(1.0 to 0.25, g.map(0.0, 0.25))
  }

  @Test
  fun cropRect() {
    val g = Geometry(400, 300, 1, EditRecipe.Crop(x = 0.25, y = 0.0, w = 0.5, h = 1.0))
    assertEquals(200, g.outputWidth)
    assertEquals(300, g.outputHeight)
    assertPoint(0.25 to 0.0, g.map(0.0, 0.0))
    assertPoint(0.75 to 1.0, g.map(1.0, 1.0))
  }

  @Test
  fun straightenStaysInsideAndShrinks() {
    val g = Geometry(4000, 3000, 1, EditRecipe.Crop(straighten = 10.0))
    assert(g.outputWidth < 4000 && g.outputHeight < 3000)
    // Same aspect ratio as the image.
    assertEquals(4.0 / 3.0, g.outputWidth.toDouble() / g.outputHeight, 0.01)
    for ((x, y) in listOf(0.0 to 0.0, 1.0 to 0.0, 0.0 to 1.0, 1.0 to 1.0)) {
      val (sx, sy) = g.map(x, y)
      assert(sx in -1e-9..1.0 + 1e-9 && sy in -1e-9..1.0 + 1e-9) { "corner ($x,$y) -> ($sx,$sy) outside" }
    }
    assertPoint(0.5 to 0.5, g.map(0.5, 0.5))
  }

  @Test
  fun positiveStraightenRotatesContentClockwise() {
    // Like iOS (rotated by -degrees in y-up space): positive = clockwise. Turning
    // content clockwise brings what was left of the top-centre to the top-centre.
    val g = Geometry(1000, 1000, 1, EditRecipe.Crop(straighten = 30.0))
    val (sx, _) = g.map(0.5, 0.0)
    assert(sx < 0.5) { "expected the top-centre to sample left of centre, got $sx" }
  }

  @Test
  fun sourceBoundsOfFullOutputIsWholeImage() {
    val g = Geometry(400, 300, 6, null)
    val b = g.sourceBounds(0.0, 0.0, 1.0, 1.0)
    assertEquals(0.0, b[0], 1e-9)
    assertEquals(1.0, b[3], 1e-9)
    assertEquals(1.0, g.sourcePixelsPerOutputPixel(400, 300), 1e-9)
  }

  @Test
  fun recipeParsing() {
    val r = EditRecipe.from(
      mapOf(
        "look" to "film",
        "intensity" to 0.5,
        "adjust" to mapOf("exposure" to 1, "grain" to 0.3),
        "crop" to mapOf("rotate" to 1, "flip" to true),
        "portrait" to mapOf("aperture" to 2.8),
      ),
    )!!
    assertEquals("film", r.look)
    assertEquals(1.0, r.exposure, 0.0)
    assertEquals(0.3, r.grain, 0.0)
    assertEquals(1, r.crop!!.rotate)
    assertEquals(2.8, r.aperture!!, 0.0)
  }
}
