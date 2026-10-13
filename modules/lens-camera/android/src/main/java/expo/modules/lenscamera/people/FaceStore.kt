package expo.modules.lenscamera.people

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * People's on-phone database (docs/design/people.md). Lives in
 * noBackupFilesDir/people, so Android's cloud backup never copies it and it is
 * never uploaded. "Delete all face data" and turning People off remove the
 * whole folder (database + model).
 */
class FaceStore private constructor(private val db: SQLiteDatabase) {
  data class FaceRow(val id: Long, val photoId: String, val groupId: Long, val embedding: FloatArray)
  data class GroupRow(val id: Long, val count: Int, val name: String?, val contactId: String?, val hidden: Boolean, val coverFaceId: Long?)

  init {
    db.execSQL("CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, scanned_at INTEGER NOT NULL, faces INTEGER NOT NULL)")
    db.execSQL(
      "CREATE TABLE IF NOT EXISTS faces (id INTEGER PRIMARY KEY AUTOINCREMENT, photo_id TEXT NOT NULL, " +
        "x INTEGER, y INTEGER, w INTEGER, h INTEGER, emb BLOB NOT NULL, thumb BLOB, sharpness REAL, " +
        "group_id INTEGER NOT NULL, score REAL, ask INTEGER NOT NULL DEFAULT 0, ask_group INTEGER)",
    )
    db.execSQL("CREATE INDEX IF NOT EXISTS faces_photo ON faces(photo_id)")
    db.execSQL("CREATE INDEX IF NOT EXISTS faces_group ON faces(group_id)")
    db.execSQL(
      "CREATE TABLE IF NOT EXISTS groups (id INTEGER PRIMARY KEY, sum BLOB NOT NULL, count INTEGER NOT NULL, " +
        "name TEXT, contact_id TEXT, hidden INTEGER NOT NULL DEFAULT 0)",
    )
    // The user's answers: these always win over the automatic grouping.
    db.execSQL("CREATE TABLE IF NOT EXISTS not_same (a INTEGER NOT NULL, b INTEGER NOT NULL, PRIMARY KEY (a, b))")
    db.execSQL("CREATE TABLE IF NOT EXISTS not_in (face_id INTEGER NOT NULL, group_id INTEGER NOT NULL, PRIMARY KEY (face_id, group_id))")
  }

  fun close() = db.close()

  fun <T> tx(block: () -> T): T {
    db.beginTransaction()
    try {
      return block().also { db.setTransactionSuccessful() }
    } finally {
      db.endTransaction()
    }
  }

  fun scannedPhotoIds(): Set<String> = db.rawQuery("SELECT id FROM photos", null).use { c ->
    HashSet<String>().apply { while (c.moveToNext()) add(c.getString(0)) }
  }

  fun markScanned(photoId: String, faces: Int) {
    db.insertWithOnConflict("photos", null, ContentValues().apply {
      put("id", photoId); put("scanned_at", System.currentTimeMillis()); put("faces", faces)
    }, SQLiteDatabase.CONFLICT_REPLACE)
  }

  fun addFace(photoId: String, f: FaceScanner.Found, a: FaceGroups.Assignment): Long =
    db.insert("faces", null, ContentValues().apply {
      put("photo_id", photoId)
      put("x", f.box.left); put("y", f.box.top); put("w", f.box.width()); put("h", f.box.height())
      put("emb", toBlob(f.embedding)); put("thumb", f.thumb); put("sharpness", f.sharpness.toDouble())
      put("group_id", a.groupId); put("score", a.score.toDouble()); put("ask", if (a.ask) 1 else 0)
      if (a.ask) put("ask_group", a.candidate)
    })

  /** Faces of photos that are gone from the phone (deleted): their rows, so groups can be updated. */
  fun facesOfPhotos(photoIds: Collection<String>): List<FaceRow> = photoIds.flatMap { id ->
    db.rawQuery("SELECT id, photo_id, group_id, emb FROM faces WHERE photo_id = ?", arrayOf(id)).use { c ->
      ArrayList<FaceRow>().apply { while (c.moveToNext()) add(FaceRow(c.getLong(0), c.getString(1), c.getLong(2), fromBlob(c.getBlob(3)))) }
    }
  }

  fun forgetPhoto(photoId: String) {
    db.delete("faces", "photo_id = ?", arrayOf(photoId))
    db.delete("photos", "id = ?", arrayOf(photoId))
  }

  fun face(id: Long): FaceRow? = db.rawQuery("SELECT id, photo_id, group_id, emb FROM faces WHERE id = ?", arrayOf(id.toString())).use { c ->
    if (c.moveToNext()) FaceRow(c.getLong(0), c.getString(1), c.getLong(2), fromBlob(c.getBlob(3))) else null
  }

  /** Loads the grouping state (sums, counts, the user's "not the same" answers). */
  fun loadGroups(into: FaceGroups) {
    val notSame = HashMap<Long, MutableList<Long>>()
    db.rawQuery("SELECT a, b FROM not_same", null).use { c ->
      while (c.moveToNext()) {
        notSame.getOrPut(c.getLong(0)) { ArrayList() }.add(c.getLong(1))
        notSame.getOrPut(c.getLong(1)) { ArrayList() }.add(c.getLong(0))
      }
    }
    db.rawQuery("SELECT id, sum, count FROM groups", null).use { c ->
      while (c.moveToNext()) into.restore(c.getLong(0), fromBlob(c.getBlob(1)), c.getInt(2), notSame[c.getLong(0)] ?: emptyList())
    }
  }

  /** Writes back every group's sum/count, removes groups that no longer exist. */
  fun saveGroups(groups: FaceGroups) {
    val keep = groups.groups.keys
    db.rawQuery("SELECT id FROM groups", null).use { c ->
      val gone = ArrayList<Long>(); while (c.moveToNext()) if (c.getLong(0) !in keep) gone.add(c.getLong(0))
      for (id in gone) db.delete("groups", "id = ?", arrayOf(id.toString()))
    }
    for (g in groups.groups.values) saveGroup(g)
  }

  fun saveGroup(g: FaceGroups.Group) {
    val values = ContentValues().apply { put("sum", toBlob(g.sum)); put("count", g.count) }
    if (db.update("groups", values, "id = ?", arrayOf(g.id.toString())) == 0) {
      values.put("id", g.id)
      db.insert("groups", null, values)
    }
  }

  /** After [FaceGroups.consolidate]: faces (and a name, if only the absorbed group had one) move to the kept group. */
  fun moveGroup(from: Long, to: Long) {
    db.execSQL("UPDATE faces SET group_id = ? WHERE group_id = ?", arrayOf(to, from))
    db.execSQL("UPDATE groups SET name = (SELECT name FROM groups WHERE id = ?) WHERE id = ? AND name IS NULL", arrayOf(from, to))
    db.execSQL("UPDATE groups SET contact_id = (SELECT contact_id FROM groups WHERE id = ?) WHERE id = ? AND contact_id IS NULL", arrayOf(from, to))
    db.execSQL("UPDATE OR IGNORE not_in SET group_id = ? WHERE group_id = ?", arrayOf(to, from))
    db.execSQL("UPDATE faces SET ask_group = ? WHERE ask_group = ?", arrayOf(to, from))
  }

  fun excludedGroups(faceId: Long): Set<Long> = db.rawQuery("SELECT group_id FROM not_in WHERE face_id = ?", arrayOf(faceId.toString())).use { c ->
    HashSet<Long>().apply { while (c.moveToNext()) add(c.getLong(0)) }
  }

  // ---------- Screens (People grid, person page) and the user's corrections ----------

  /** Groups with at least [minPhotos] photos, biggest first, with the sharpest face as cover. */
  fun listGroups(minPhotos: Int, includeHidden: Boolean): List<Map<String, Any?>> =
    db.rawQuery(
      "SELECT g.id, g.name, g.contact_id, g.hidden, COUNT(DISTINCT f.photo_id) AS photos, " +
        "(SELECT f2.id FROM faces f2 WHERE f2.group_id = g.id ORDER BY f2.sharpness DESC LIMIT 1) AS cover " +
        "FROM groups g JOIN faces f ON f.group_id = g.id " +
        (if (includeHidden) "" else "WHERE g.hidden = 0 ") +
        "GROUP BY g.id HAVING photos >= ? ORDER BY (g.name IS NULL), photos DESC",
      arrayOf(minPhotos.toString()),
    ).use { c ->
      ArrayList<Map<String, Any?>>().apply {
        while (c.moveToNext()) add(
          mapOf(
            "id" to c.getLong(0), "name" to c.getString(1), "contactId" to c.getString(2),
            "hidden" to (c.getInt(3) == 1), "photos" to c.getInt(4), "coverFaceId" to c.getLong(5),
          ),
        )
      }
    }

  /** Photo ids of a person, with the face id in each (for "not this person"). */
  fun groupPhotos(groupId: Long): List<Map<String, Any?>> =
    db.rawQuery("SELECT photo_id, id FROM faces WHERE group_id = ? ORDER BY id DESC", arrayOf(groupId.toString())).use { c ->
      ArrayList<Map<String, Any?>>().apply { while (c.moveToNext()) add(mapOf("photoId" to c.getString(0), "faceId" to c.getLong(1))) }
    }

  fun thumb(faceId: Long): ByteArray? =
    db.rawQuery("SELECT thumb FROM faces WHERE id = ?", arrayOf(faceId.toString())).use { c -> if (c.moveToNext()) c.getBlob(0) else null }

  /** Faces the app should ask about ("Is this Riya?"): close to a person the user named, but not sure. */
  fun asks(limit: Int): List<Map<String, Any?>> =
    db.rawQuery(
      "SELECT f.id, f.ask_group, f.photo_id FROM faces f JOIN groups g ON g.id = f.ask_group " +
        // Only about people the user named or linked: never a flood of questions about strangers.
        "WHERE f.ask = 1 AND f.group_id != f.ask_group AND (g.name IS NOT NULL OR g.contact_id IS NOT NULL) " +
        "AND NOT EXISTS (SELECT 1 FROM not_in n WHERE n.face_id = f.id AND n.group_id = f.ask_group) ORDER BY f.id DESC LIMIT ?",
      arrayOf(limit.toString()),
    ).use { c ->
      ArrayList<Map<String, Any?>>().apply { while (c.moveToNext()) add(mapOf("faceId" to c.getLong(0), "groupId" to c.getLong(1), "photoId" to c.getString(2))) }
    }

  fun clearAsk(faceId: Long) = db.execSQL("UPDATE faces SET ask = 0 WHERE id = ?", arrayOf(faceId))

  fun setName(groupId: Long, name: String?) =
    db.execSQL("UPDATE groups SET name = ? WHERE id = ?", arrayOf(name?.trim()?.takeIf { it.isNotEmpty() }, groupId))

  fun setContact(groupId: Long, contactId: String?) = db.execSQL("UPDATE groups SET contact_id = ? WHERE id = ?", arrayOf(contactId, groupId))

  fun setHidden(groupId: Long, hidden: Boolean) = db.execSQL("UPDATE groups SET hidden = ? WHERE id = ?", arrayOf(if (hidden) 1 else 0, groupId))

  fun addNotSame(a: Long, b: Long) =
    db.execSQL("INSERT OR IGNORE INTO not_same (a, b) VALUES (?, ?)", arrayOf(minOf(a, b), maxOf(a, b)))

  fun addNotIn(faceId: Long, groupId: Long) =
    db.execSQL("INSERT OR IGNORE INTO not_in (face_id, group_id) VALUES (?, ?)", arrayOf(faceId, groupId))

  fun setFaceGroup(faceId: Long, groupId: Long) =
    db.execSQL("UPDATE faces SET group_id = ?, ask = 0 WHERE id = ?", arrayOf(groupId, faceId))

  fun counts(): Map<String, Int> = mapOf(
    "photos" to scalar("SELECT COUNT(*) FROM photos"),
    "faces" to scalar("SELECT COUNT(*) FROM faces"),
    "groups" to scalar("SELECT COUNT(*) FROM groups"),
  )

  private fun scalar(sql: String): Int = db.rawQuery(sql, null).use { c -> if (c.moveToNext()) c.getInt(0) else 0 }

  companion object {
    fun dir(context: Context) = File(context.noBackupFilesDir, "people")

    fun open(context: Context): FaceStore {
      val dir = dir(context).apply { mkdirs() }
      return FaceStore(SQLiteDatabase.openOrCreateDatabase(File(dir, "people.db"), null))
    }

    /** "Delete all face data" / People off: the database and the model, nothing left. */
    fun deleteAll(context: Context) {
      dir(context).deleteRecursively()
    }

    fun toBlob(v: FloatArray): ByteArray =
      ByteBuffer.allocate(v.size * 4).order(ByteOrder.LITTLE_ENDIAN).apply { for (x in v) putFloat(x) }.array()

    fun fromBlob(b: ByteArray): FloatArray {
      val buf = ByteBuffer.wrap(b).order(ByteOrder.LITTLE_ENDIAN)
      return FloatArray(b.size / 4) { buf.float }
    }
  }
}
