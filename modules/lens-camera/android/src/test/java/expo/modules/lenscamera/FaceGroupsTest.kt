package expo.modules.lenscamera

import expo.modules.lenscamera.people.FaceAlign
import expo.modules.lenscamera.people.FaceGroups
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.cos
import kotlin.math.sin

class FaceGroupsTest {
  private val dim = 4
  /** Unit vector at [deg] degrees in the x/y plane, plus a little z so faces differ. */
  private fun v(deg: Double, z: Float = 0f) = FaceAlign.normalize(floatArrayOf(cos(Math.toRadians(deg)).toFloat(), sin(Math.toRadians(deg)).toFloat(), z, 0f))

  @Test fun samePersonJoinsDifferentPersonStartsOwnGroup() {
    val g = FaceGroups(dim)
    val a = g.add(v(0.0))
    assertTrue(a.newGroup)
    // cos(20°) = 0.94 ≥ 0.45 → same group.
    val b = g.add(v(20.0))
    assertEquals(a.groupId, b.groupId)
    // cos(80°) = 0.17 < 0.363 → new group, no question.
    val c = g.add(v(80.0))
    assertTrue(c.newGroup); assertFalse(c.ask)
  }

  @Test fun inBetweenStartsOwnGroupAndAsks() {
    val g = FaceGroups(dim)
    val a = g.add(v(0.0))
    // cos(66°) = 0.407: between MATCH and MERGE.
    val b = g.add(v(66.0))
    assertTrue(b.newGroup); assertTrue(b.ask); assertEquals(a.groupId, b.candidate)
  }

  @Test fun averageLinkageNotInflatedMean() {
    // Group of two faces 120° apart: their normalised mean would be close to a face at 60°
    // (cos 1.0), but the AVERAGE similarity to the two members is cos 60° = 0.5.
    val g = FaceGroups(dim)
    val x = g.add(v(0.0))
    g.addTo(x.groupId, v(120.0))
    assertEquals(0.5f, g.score(v(60.0), g.groups[x.groupId]!!), 1e-5f)
  }

  @Test fun consolidateMergesSamePersonButRespectsNotSame() {
    val g = FaceGroups(dim)
    g.restore(1, v(0.0), 1)
    g.restore(2, v(30.0), 1)          // cos 30° = 0.87: same person
    g.restore(3, v(31.0), 1, listOf(4))
    g.restore(4, v(32.0), 1, listOf(3)) // the user said 3 and 4 are different
    val merges = g.consolidate()
    assertTrue(merges.isNotEmpty())
    // 3 and 4 must never end up together.
    val owner = HashMap<Long, Long>()
    for (id in listOf(1L, 2L, 3L, 4L)) owner[id] = id
    for ((keep, gone) in merges) for (k in owner.keys) if (owner[k] == gone) owner[k] = keep
    assertTrue(owner[3] != owner[4])
  }

  @Test fun excludedGroupIsSkipped() {
    val g = FaceGroups(dim)
    val a = g.add(v(0.0))
    val b = g.add(v(5.0), excluded = setOf(a.groupId))
    assertTrue(b.newGroup)
    assertTrue(b.groupId != a.groupId)
  }

  @Test fun removeTakesFaceOutOfSum() {
    val g = FaceGroups(dim)
    val a = g.add(v(0.0))
    g.add(v(10.0))
    g.remove(a.groupId, v(10.0))
    assertEquals(1, g.groups[a.groupId]!!.count)
    assertEquals(1f, g.score(v(0.0), g.groups[a.groupId]!!), 1e-5f)
  }
}
