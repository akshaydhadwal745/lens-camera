package expo.modules.lenscamera

import expo.modules.lenscamera.people.FaceAlign
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FaceAlignTest {
  private val all = intArrayOf(0, 1, 2, 3, 4)
  private fun pts(vararg xy: Float) = Array(xy.size / 2) { floatArrayOf(xy[it * 2], xy[it * 2 + 1]) }

  // Expected matrices from research/faces/spike.py similarity() (Umeyama via SVD, numpy).
  @Test fun matchesNumpyUmeyama() {
    val a = FaceAlign.cropMatrix(pts(120.5f, 140.2f, 180.3f, 138.9f, 150.1f, 175.4f, 128.7f, 205.6f, 176.2f, 204.1f), all)
    assertArrayEquals(doubleArrayOf(0.611952, -0.014449, -33.979277, 0.014449, 0.611952, -36.053112), a, 2e-5)
    val b = FaceAlign.cropMatrix(pts(300f, 200f, 360f, 230f, 320f, 260f, 290f, 290f, 340f, 315f), all)
    assertArrayEquals(doubleArrayOf(0.456249, 0.131016, -124.819074, -0.131016, 0.456249, -4.080584), b, 2e-5)
  }

  @Test fun templateMapsOntoItself() {
    val m = FaceAlign.cropMatrix(FaceAlign.TEMPLATE)
    assertArrayEquals(doubleArrayOf(1.0, 0.0, 0.0, 0.0, 1.0, 0.0), m, 1e-6)
  }

  @Test fun scaledShiftedFaceIsUndone() {
    // Template scaled x3 and moved by (500, 80): the crop matrix must invert exactly that.
    val face = Array(5) { floatArrayOf(FaceAlign.TEMPLATE[it][0] * 3 + 500, FaceAlign.TEMPLATE[it][1] * 3 + 80) }
    val m = FaceAlign.cropMatrix(face)
    assertArrayEquals(doubleArrayOf(1 / 3.0, 0.0, -500 / 3.0, 0.0, 1 / 3.0, -80 / 3.0), m, 1e-4) // float32 input points
  }

  @Test fun eyeAndMouthOrderDoesNotDependOnNaming() {
    val l = floatArrayOf(10f, 10f); val r = floatArrayOf(30f, 10f)
    val ml = floatArrayOf(12f, 30f); val mr = floatArrayOf(28f, 30f); val n = floatArrayOf(20f, 20f)
    val o = FaceAlign.orderLandmarks(r, l, n, mr, ml)
    assertEquals(10f, o[0][0]); assertEquals(30f, o[1][0]); assertEquals(12f, o[3][0]); assertEquals(28f, o[4][0])
    assertEquals(20f, FaceAlign.eyeDistance(o), 1e-4f)
  }

  @Test fun cosineAndNormalize() {
    val v = FaceAlign.normalize(floatArrayOf(3f, 4f))
    assertEquals(0.6f, v[0], 1e-6f); assertEquals(0.8f, v[1], 1e-6f)
    assertEquals(1f, FaceAlign.cosine(floatArrayOf(1f, 2f), floatArrayOf(2f, 4f)), 1e-6f)
    assertTrue(FaceAlign.cosine(floatArrayOf(1f, 0f), floatArrayOf(0f, 1f)) == 0f)
  }
}
