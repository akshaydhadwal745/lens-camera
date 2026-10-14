package expo.modules.lenscamera

import expo.modules.lenscamera.imaging.GroupShotMath
import expo.modules.lenscamera.imaging.GroupShotMath.Motion
import expo.modules.lenscamera.imaging.GroupShotMath.Rgb
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs
import kotlin.math.sin
import kotlin.random.Random

/** Best group photo pixel work: the same synthetic check as research/groupshot/groupshot.py. */
class GroupShotMathTest {
  private val w = 160
  private val h = 160

  /** A textured scene (smooth noise + shapes), like skin/hair/background detail. */
  private fun scene(): Rgb {
    val rnd = Random(7)
    val noise = FloatArray(w * h) { rnd.nextFloat() * 255 }
    val smooth = GroupShotMath.blur(noise, w, h, 2.0)
    val img = Rgb(w, h)
    for (i in 0 until w * h) {
      val x = i % w
      val y = i / w
      val base = smooth[i] * 0.6f + (90 + 60 * sin(x / 9.0) * sin(y / 13.0)).toFloat()
      img.r[i] = (base + 40).coerceIn(0f, 255f)
      img.g[i] = (base + 10).coerceIn(0f, 255f)
      img.b[i] = (base - 20).coerceIn(0f, 255f)
    }
    return img
  }

  private fun brighter(img: Rgb, k: Float) = Rgb(img.w, img.h, FloatArray(w * h) { (img.r[it] * k).coerceAtMost(255f) }, FloatArray(w * h) { (img.g[it] * k).coerceAtMost(255f) }, FloatArray(w * h) { (img.b[it] * k).coerceAtMost(255f) })

  /** Inverse of `warp`: where the donor sits is `truth` applied to the original. */
  private fun moved(img: Rgb, m: Motion) = GroupShotMath.warp(img, Motion(-m.deg, 0.0, 0.0)).let { GroupShotMath.warp(it, Motion(0.0, -m.dx, -m.dy)) }

  @Test
  fun alignRecoversTheHandMovement() {
    val original = scene()
    val truth = Motion(1.0, 5.3, -2.7)
    val donor = moved(original, truth)
    val use = BooleanArray(w * h) { true }
    val found = GroupShotMath.align(original.luma(), donor.luma(), use, w, h)
    val back = GroupShotMath.warp(donor, found)
    // The interior (edges clamp) must line up with the original almost exactly.
    val inner = Rgb(100, 100)
    val ref = Rgb(100, 100)
    for (y in 0 until 100) for (x in 0 until 100) {
      val i = (y + 30) * w + x + 30
      val j = y * 100 + x
      inner.r[j] = back.r[i]; inner.g[j] = back.g[i]; inner.b[j] = back.b[i]
      ref.r[j] = original.r[i]; ref.g[j] = original.g[i]; ref.b[j] = original.b[i]
    }
    assertTrue("aligned PSNR ${GroupShotMath.psnr(inner, ref)}", GroupShotMath.psnr(inner, ref) > 30)
    assertEquals(1.0, abs(found.deg), 0.5)
  }

  @Test
  fun swapRestoresTheFaceWithoutASeam() {
    val original = scene()
    // "Blink": a flat patch over the eye band in the base.
    val base = Rgb(w, h, original.r.copyOf(), original.g.copyOf(), original.b.copyOf())
    for (y in 62..74) for (x in 50..110) { val i = y * w + x; base.r[i] = 150f; base.g[i] = 120f; base.b[i] = 100f }
    val donor = brighter(original, 1.08f)
    val face = GroupShotMath.ellipse(w, h, 80.0, 75.0, 40.0, 50.0, 0.0)
    val ringOuter = GroupShotMath.ellipse(w, h, 80.0, 75.0, 58.0, 65.0, 0.0)
    val ring = BooleanArray(w * h) { ringOuter[it] > 0 && face[it] == 0f }
    val recoloured = GroupShotMath.matchColour(base, donor, ring)
    val soft = GroupShotMath.blur(face, w, h, 6.0)
    val out = GroupShotMath.blend(base, recoloured, soft)
    // Inside the face: back to the original (the patch is gone, brightness matched).
    val before = GroupShotMath.psnr(crop(base), crop(original))
    val after = GroupShotMath.psnr(crop(out), crop(original))
    assertTrue("blink $before dB → fixed $after dB", after > 32 && after - before > 6)
  }

  @Test
  fun occludedDonorFailsTheGuard() {
    val original = scene()
    val face = GroupShotMath.ellipse(w, h, 80.0, 75.0, 40.0, 50.0, 0.0)
    val ringOuter = GroupShotMath.ellipse(w, h, 80.0, 75.0, 58.0, 65.0, 0.0)
    val ring = BooleanArray(w * h) { ringOuter[it] > 0 && face[it] == 0f }
    assertTrue(GroupShotMath.ncc(original.luma(), brighter(original, 1.08f).luma(), ring) > 0.95)
    val blocked = Rgb(w, h, original.r.copyOf(), original.g.copyOf(), original.b.copyOf())
    for (y in 0 until h) for (x in 0 until 90) { val i = y * w + x; blocked.r[i] = 40f; blocked.g[i] = 140f; blocked.b[i] = 40f }
    assertTrue(GroupShotMath.ncc(original.luma(), blocked.luma(), ring) < 0.6)
  }

  @Test
  fun labRoundTripsColours() {
    val img = scene()
    val back = GroupShotMath.fromLab(GroupShotMath.toLab(img), w, h)
    assertTrue(GroupShotMath.psnr(img, back) > 45)
  }

  private fun crop(img: Rgb): Rgb {
    val out = Rgb(60, 60)
    for (y in 0 until 60) for (x in 0 until 60) {
      val i = (y + 45) * w + x + 50
      val j = y * 60 + x
      out.r[j] = img.r[i]; out.g[j] = img.g[i]; out.b[j] = img.b[i]
    }
    return out
  }
}
