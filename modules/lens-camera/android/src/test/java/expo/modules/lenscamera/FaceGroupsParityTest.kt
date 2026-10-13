package expo.modules.lenscamera

import expo.modules.lenscamera.people.FaceGroups
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The phone's grouping must make exactly the decisions measured in
 * research/faces/cluster.py. Fixture: 209 real LFW face embeddings (phone setup:
 * int8 model, 4-point alignment) in a fixed order + the groups Python formed.
 */
class FaceGroupsParityTest {
  private fun lists(section: String): List<List<String>> =
    Regex("""\[([^\[\]]*)]""").findAll(section).map { m -> m.groupValues[1].split(',').map { it.trim() }.filter { it.isNotEmpty() } }.toList()

  @Test fun sameGroupsAsPython() {
    val json = javaClass.classLoader!!.getResource("people-fixture.json")!!.readText()
    val embSection = json.substringAfter("\"embeddings\":").substringBefore("\"groups\":")
    val groupSection = json.substringAfter("\"groups\":").substringBefore("\"asks\":")
    val faces = lists(embSection).map { row -> FloatArray(row.size) { row[it].toFloat() } }
    val expected = lists(groupSection).map { row -> row.map { it.toInt() }.sorted() }.sortedBy { it.joinToString(",") }
    val expectedAsks = json.substringAfter("\"asks\":").trim().trimEnd('}').trim().toInt()

    val g = FaceGroups(128)
    val groupOf = IntArray(faces.size)
    var asks = 0
    faces.forEachIndexed { i, e ->
      val a = g.add(e)
      groupOf[i] = a.groupId.toInt()
      if (a.ask) asks++
    }
    // Consolidation merges whole groups: follow each absorbed id to its keeper.
    val owner = HashMap<Int, Int>()
    for ((keep, gone) in g.consolidate()) {
      owner[gone.toInt()] = keep.toInt()
    }
    fun root(x: Int): Int { var r = x; while (owner.containsKey(r)) r = owner[r]!!; return r }
    val actual = faces.indices.groupBy { root(groupOf[it]) }.values.map { it.sorted() }.sortedBy { it.joinToString(",") }

    assertEquals(expectedAsks, asks)
    assertEquals(expected.size, actual.size)
    assertEquals(expected, actual)
  }
}
