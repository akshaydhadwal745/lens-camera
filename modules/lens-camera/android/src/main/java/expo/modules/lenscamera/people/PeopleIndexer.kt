package expo.modules.lenscamera.people

import android.content.Context
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import org.json.JSONArray
import java.io.File

/**
 * People: one scanning pass (docs/design/people.md). Runs from [PeopleJob]
 * while the phone charges, or on demand from the self-test. It:
 *  1. reads Lens's own photo list (captures-index.json; own photos only:
 *     no videos, no gallery imports),
 *  2. forgets faces of photos that were deleted,
 *  3. scans new photos newest first (their on-phone previews),
 *  4. merges same-person groups.
 * Stops early when asked, when the phone gets warm, or at the time budget, and
 * saves as it goes, so the next charge continues where this one stopped.
 */
object PeopleIndexer {
  private const val TAG = "LensPeople"
  const val MODEL_FILE = "sface-v1.tflite"

  data class Stats(val scanned: Int, val faces: Int, val forgotten: Int, val merged: Int, val left: Int, val stoppedBy: String?)

  fun modelFile(context: Context) = File(FaceStore.dir(context), MODEL_FILE)

  /** Lens's own photos with a preview on the phone, newest first: (id, preview file). */
  fun ownPhotos(context: Context): List<Pair<String, File>> {
    val index = File(context.filesDir, "captures-index.json")
    if (!index.exists()) return emptyList()
    val captures = File(context.filesDir, "captures")
    val arr = runCatching { JSONArray(index.readText()) }.getOrNull() ?: return emptyList()
    val out = ArrayList<Triple<String, File, Long>>()
    for (i in 0 until arr.length()) {
      val e = arr.optJSONObject(i) ?: continue
      if (e.optString("kind") != "photo" || e.has("importUri")) continue
      val preview = e.optString("previewFile").takeIf { it.isNotEmpty() } ?: continue
      val file = File(captures, preview)
      if (file.exists()) out.add(Triple(e.optString("id"), file, e.optLong("createdAt")))
    }
    return out.sortedByDescending { it.third }.map { it.first to it.second }
  }

  private fun warm(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < 29) return false
    val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    return power.currentThermalStatus >= PowerManager.THERMAL_STATUS_MODERATE
  }

  /** One pass at a time (the charging job and an on-demand scan share the database). */
  @Synchronized
  fun run(context: Context, budgetMs: Long, shouldStop: () -> Boolean): Stats? {
    val model = modelFile(context)
    if (!model.exists()) return null
    val embedder = FaceEmbedder.open(context, model) ?: return null
    val store = FaceStore.open(context)
    val groups = FaceGroups()
    val t0 = SystemClock.elapsedRealtime()
    var scanned = 0; var faces = 0; var forgotten = 0; var stoppedBy: String? = null
    try {
      store.loadGroups(groups)
      val photos = ownPhotos(context)
      val present = photos.mapTo(HashSet()) { it.first }
      val done = store.scannedPhotoIds()

      // Deleted photos: take their faces out of their groups.
      val gone = done.filter { it !in present }
      if (gone.isNotEmpty()) store.tx {
        for (f in store.facesOfPhotos(gone)) groups.remove(f.groupId, f.embedding)
        gone.forEach { store.forgetPhoto(it) }
        store.saveGroups(groups)
      }
      forgotten = gone.size

      val todo = photos.filter { it.first !in done }
      FaceScanner(embedder).use { scanner ->
        for (photo in todo) {
          stoppedBy = when {
            shouldStop() -> "stopped"
            SystemClock.elapsedRealtime() - t0 > budgetMs -> "time"
            warm(context) -> "warm"
            else -> null
          }
          if (stoppedBy != null) break
          val r = scanner.scan(photo.second)
          // One transaction per photo: its faces and the groups they touched land together.
          store.tx {
            for (f in r.faces) {
              val a = groups.add(f.embedding)
              store.addFace(photo.first, f, a)
              groups.groups[a.groupId]?.let { store.saveGroup(it) }
            }
            store.markScanned(photo.first, r.faces.size)
          }
          scanned++; faces += r.faces.size
        }
      }
      val merges = groups.consolidate()
      store.tx {
        for ((keep, gone2) in merges) store.moveGroup(gone2, keep)
        store.saveGroups(groups)
      }
      val left = (todo.size - scanned).coerceAtLeast(0)
      return Stats(scanned, faces, forgotten, merges.size, left, stoppedBy).also { Log.i(TAG, "pass: $it") }
    } finally {
      embedder.close()
      store.close()
    }
  }
}
