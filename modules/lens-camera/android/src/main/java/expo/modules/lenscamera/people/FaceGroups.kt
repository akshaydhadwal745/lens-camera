package expo.modules.lenscamera.people

/**
 * People grouping (docs/design/people.md). Same algorithm as
 * research/faces/cluster.py, where it is measured on LFW:
 *  - a face joins the group with the best AVERAGE similarity to its members when
 *    that is >= [MERGE] (average linkage = dot product with the group's
 *    unnormalised mean, exactly; one vector per group);
 *  - between [MATCH] and [MERGE] it starts its own group and is remembered as a
 *    question for the user ("Is this Riya?");
 *  - [consolidate] merges groups that are the same person on average.
 * The user's answers always win: a face marked "not this person" never joins
 * that group again, and groups the user said are different are never merged.
 */
class FaceGroups(private val dim: Int = FaceEmbedder.DIM) {
  class Group(val id: Long, val sum: FloatArray, var count: Int) {
    /** The user said these groups are different people. */
    val notSame = HashSet<Long>()
    fun mean(i: Int) = sum[i] / count
  }

  /** [candidate]: the closest group when the face started its own (asked about when [ask]). */
  data class Assignment(val groupId: Long, val score: Float, val newGroup: Boolean, val ask: Boolean, val candidate: Long? = null)

  val groups = LinkedHashMap<Long, Group>()
  private var nextId = 1L
  /** Groups changed since the last [consolidate]: only pairs with one of these are checked. */
  private val dirty = LinkedHashSet<Long>()

  fun restore(id: Long, sum: FloatArray, count: Int, notSame: Collection<Long> = emptyList()) {
    groups[id] = Group(id, sum, count).also { it.notSame.addAll(notSame) }
    if (id >= nextId) nextId = id + 1
    dirty.add(id)
  }

  /** Average similarity of [e] (unit length) to [g]'s members. */
  fun score(e: FloatArray, g: Group): Float {
    var s = 0f
    for (i in 0 until dim) s += e[i] * g.sum[i]
    return s / g.count
  }

  /** [excluded]: groups this face must not join (the user said "not this person"). */
  fun add(e: FloatArray, excluded: Set<Long> = emptySet()): Assignment {
    var best: Group? = null
    var bestScore = -1f
    for (g in groups.values) {
      if (g.id in excluded) continue
      val s = score(e, g)
      if (s > bestScore) { best = g; bestScore = s }
    }
    if (best != null && bestScore >= MERGE) {
      for (i in 0 until dim) best.sum[i] += e[i]
      best.count++
      dirty.add(best.id)
      return Assignment(best.id, bestScore, newGroup = false, ask = false)
    }
    val g = Group(nextId++, e.copyOf(), 1)
    groups[g.id] = g
    dirty.add(g.id)
    return Assignment(g.id, bestScore, newGroup = true, ask = bestScore >= MATCH, candidate = best?.id)
  }

  /** Average linkage between two groups = mean_a · mean_b. */
  fun linkage(a: Group, b: Group): Float {
    var s = 0f
    for (i in 0 until dim) s += a.sum[i] * b.sum[i]
    return s / (a.count.toFloat() * b.count)
  }

  /**
   * Merges same-person groups, best pair first. Returns (kept, absorbed) id
   * pairs so the store can move faces. The larger group keeps its id (and name).
   */
  fun consolidate(): List<Pair<Long, Long>> {
    val merges = ArrayList<Pair<Long, Long>>()
    while (true) {
      var a: Group? = null; var b: Group? = null; var bestScore = MERGE
      val all = groups.values.toList()
      for (d in dirty.toList()) {
        val p = groups[d] ?: continue
        for (q in all) {
          if (q === p || q.id in p.notSame || p.id in q.notSame) continue
          val s = linkage(p, q)
          if (s >= bestScore) { a = p; b = q; bestScore = s }
        }
      }
      if (a == null || b == null) {
        dirty.clear()
        return merges
      }
      val (keep, gone) = if (a.count >= b.count) a to b else b to a
      for (i in 0 until dim) keep.sum[i] += gone.sum[i]
      keep.count += gone.count
      keep.notSame.addAll(gone.notSame)
      groups.remove(gone.id)
      dirty.remove(gone.id)
      dirty.add(keep.id)
      for (g in groups.values) if (g.notSame.remove(gone.id)) g.notSame.add(keep.id)
      merges.add(keep.id to gone.id)
    }
  }

  /** The user confirmed this one face belongs to [groupId]. */
  fun addTo(groupId: Long, e: FloatArray): Boolean {
    val g = groups[groupId] ?: return false
    for (i in 0 until dim) g.sum[i] += e[i]
    g.count++
    dirty.add(groupId)
    return true
  }

  /** The user said these are the same person: merge even below [MERGE]. */
  fun mergeForced(keepId: Long, goneId: Long): Boolean {
    val keep = groups[keepId] ?: return false
    val gone = groups[goneId] ?: return false
    if (keep === gone) return false
    for (i in 0 until dim) keep.sum[i] += gone.sum[i]
    keep.count += gone.count
    keep.notSame.addAll(gone.notSame)
    keep.notSame.remove(keep.id)
    groups.remove(goneId)
    dirty.remove(goneId)
    dirty.add(keepId)
    for (g in groups.values) if (g.notSame.remove(goneId)) g.notSame.add(keepId)
    return true
  }

  /** Takes a face out of a group (the user said "not this person"). */
  fun remove(groupId: Long, e: FloatArray) {
    val g = groups[groupId] ?: return
    if (g.count <= 1) { groups.remove(groupId); dirty.remove(groupId); return }
    for (i in 0 until dim) g.sum[i] -= e[i]
    g.count--
    dirty.add(groupId)
  }

  companion object {
    /** LFW 6000 pairs, phone setup (int8, 4-point): 0 wrong merges at 0.45. */
    const val MERGE = 0.45f
    /** OpenCV's same-person threshold: between this and MERGE the app asks. */
    const val MATCH = 0.363f
  }
}
