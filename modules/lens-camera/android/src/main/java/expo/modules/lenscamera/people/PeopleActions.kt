package expo.modules.lenscamera.people

import android.content.Context

/**
 * The user's corrections (docs/design/people.md: they always win). Each holds
 * the indexer's lock, so it never runs at the same time as a scanning pass.
 */
object PeopleActions {
  private fun <T> withGroups(context: Context, block: (FaceStore, FaceGroups) -> T): T = synchronized(PeopleIndexer) {
    val store = FaceStore.open(context)
    try {
      val groups = FaceGroups().also { store.loadGroups(it) }
      store.tx { block(store, groups).also { store.saveGroups(groups) } }
    } finally {
      store.close()
    }
  }

  /** "Same person": [other] joins [keep] (its name is kept if [keep] has none). */
  fun merge(context: Context, keep: Long, other: Long) = withGroups(context) { store, groups ->
    if (groups.mergeForced(keep, other)) store.moveGroup(other, keep)
  }

  /** "Different people": these two groups are never merged automatically. */
  fun notSame(context: Context, a: Long, b: Long) = withGroups(context) { store, groups ->
    store.addNotSame(a, b)
    groups.groups[a]?.notSame?.add(b)
    groups.groups[b]?.notSame?.add(a)
  }

  /** "Not this person": the face leaves the group for good and finds its own place. */
  fun notThis(context: Context, faceId: Long): Long? = withGroups(context) { store, groups ->
    val face = store.face(faceId) ?: return@withGroups null
    groups.remove(face.groupId, face.embedding)
    store.addNotIn(faceId, face.groupId)
    val a = groups.add(face.embedding, store.excludedGroups(faceId))
    store.setFaceGroup(faceId, a.groupId)
    a.groupId
  }

  /** "Yes, that's them" for an ask: the face joins [groupId]. */
  fun confirm(context: Context, faceId: Long, groupId: Long) = withGroups(context) { store, groups ->
    val face = store.face(faceId) ?: return@withGroups
    if (face.groupId != groupId && groups.groups.containsKey(groupId)) {
      // Only this face moves; the rest of its group stays unconfirmed.
      groups.remove(face.groupId, face.embedding)
      groups.addTo(groupId, face.embedding)
      store.setFaceGroup(faceId, groupId)
    }
    store.clearAsk(faceId)
  }

  /** "No, that's not them" for an ask: never suggested for [groupId] again. */
  fun reject(context: Context, faceId: Long, groupId: Long) = withGroups(context) { store, _ ->
    store.addNotIn(faceId, groupId)
    store.clearAsk(faceId)
  }
}
