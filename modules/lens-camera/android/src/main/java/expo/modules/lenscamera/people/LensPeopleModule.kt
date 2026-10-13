package expo.modules.lenscamera.people

import android.os.SystemClock
import android.util.Base64
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * People (docs/design/people.md), Android only: turning it on/off, the charging
 * job, the People screens and the user's corrections, plus the self-test benchmark.
 * Nothing here uploads anything; face data stays on the phone.
 */
class LensPeopleModule : Module() {
  private val context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("LensPeople")

    /** People needs Google Play services (ML Kit faces + LiteRT runtime). */
    Function("available") {
      GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
    }

    /**
     * Scans [photos] with the model at [modelPath] and reports timings. Returns
     * every face's embedding so the self-test can check matches and compare phone vs PC.
     */
    AsyncFunction("benchmark") { modelPath: String, photos: List<String> ->
      val t0 = SystemClock.elapsedRealtime()
      val embedder = FaceEmbedder.open(context, File(modelPath.removePrefix("file://")))
        ?: return@AsyncFunction mapOf("ok" to false, "error" to "LiteRT not available")
      val initMs = SystemClock.elapsedRealtime() - t0
      val results = ArrayList<Map<String, Any?>>()
      var detectMs = 0L; var embedMs = 0L; var faces = 0; var skipped = 0
      embedder.use { e ->
        FaceScanner(e).use { scanner ->
          for (path in photos) {
            val r = scanner.scan(File(path.removePrefix("file://")))
            detectMs += r.detectMs; embedMs += r.embedMs; faces += r.faces.size; skipped += r.skipped
            results.add(
              mapOf(
                "faces" to r.faces.size,
                "skipped" to r.skipped,
                "detectMs" to r.detectMs,
                "embedMs" to r.embedMs,
                "sharpness" to r.faces.map { it.sharpness.toDouble() },
                "eyeDistance" to r.faces.map { it.eyeDistance.toDouble() },
                "embeddings" to r.faces.map { f -> f.embedding.map { it.toDouble() } },
              ),
            )
          }
        }
      }
      mapOf(
        "ok" to true,
        "initMs" to initMs,
        "photos" to photos.size,
        "faces" to faces,
        "skipped" to skipped,
        "detectMsPerPhoto" to if (photos.isEmpty()) 0 else detectMs / photos.size,
        "embedMsPerFace" to if (faces == 0) 0 else embedMs / faces,
        "results" to results,
      )
    }

    /**
     * Self-test: the real scanner + grouping (same code as the charging job) on
     * [photos], in memory only (never touches People's database). Returns, per
     * group, the indexes of the photos it contains.
     */
    AsyncFunction("groupTest") { modelPath: String, photos: List<String> ->
      val embedder = FaceEmbedder.open(context, File(modelPath.removePrefix("file://")))
        ?: return@AsyncFunction mapOf("ok" to false, "error" to "LiteRT not available")
      val groups = FaceGroups()
      val faceGroup = ArrayList<Pair<Int, Long>>() // (photo index, group id)
      var faces = 0
      val t0 = SystemClock.elapsedRealtime()
      embedder.use { e ->
        FaceScanner(e).use { scanner ->
          photos.forEachIndexed { i, path ->
            for (f in scanner.scan(File(path.removePrefix("file://"))).faces) {
              faceGroup.add(i to groups.add(f.embedding).groupId)
              faces++
            }
          }
        }
      }
      val owner = HashMap<Long, Long>()
      for ((keep, gone) in groups.consolidate()) owner[gone] = keep
      fun root(id: Long): Long { var r = id; while (owner.containsKey(r)) r = owner[r]!!; return r }
      val byGroup = faceGroup.groupBy({ root(it.second) }, { it.first })
      mapOf(
        "ok" to true,
        "faces" to faces,
        "ms" to SystemClock.elapsedRealtime() - t0,
        "groups" to byGroup.values.map { it.distinct().sorted() },
      )
    }

    /** On = model present. [scanning]: a pass is running. Counts come from the on-phone database. */
    AsyncFunction("status") {
      val on = PeopleIndexer.modelFile(context).exists()
      val counts = if (on) synchronized(PeopleIndexer) { FaceStore.open(context).let { s -> try { s.counts() } finally { s.close() } } } else emptyMap()
      mapOf("on" to on, "ownPhotos" to if (on) PeopleIndexer.ownPhotos(context).size else 0) + counts
    }

    /**
     * Turns People on: downloads the model ([url], ~10 MB) into the no-backup
     * folder, checks its SHA-256, then schedules the charging job.
     */
    AsyncFunction("enable") { url: String, sha256: String ->
      // The face engine comes from Google Play services: get it first, so People never
      // turns on without being able to run (Play services downloads it on first use).
      if (!FaceEmbedder.prepare(context)) {
        throw IllegalStateException("Google Play services couldn't set up the face engine right now. Try again on Wi-Fi in a few minutes.")
      }
      val model = PeopleIndexer.modelFile(context)
      if (!model.exists()) {
        model.parentFile?.mkdirs()
        val tmp = File(model.parentFile, "${model.name}.part")
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 15000; conn.readTimeout = 30000
        try {
          if (conn.responseCode != 200) throw IllegalStateException("model download failed (${conn.responseCode})")
          val digest = MessageDigest.getInstance("SHA-256")
          conn.inputStream.use { input -> tmp.outputStream().use { out ->
            val buf = ByteArray(64 * 1024)
            while (true) { val n = input.read(buf); if (n < 0) break; digest.update(buf, 0, n); out.write(buf, 0, n) }
          } }
          val hex = digest.digest().joinToString("") { "%02x".format(it) }
          if (!hex.equals(sha256, ignoreCase = true)) { tmp.delete(); throw IllegalStateException("model checksum mismatch") }
          if (!tmp.renameTo(model)) throw IllegalStateException("could not save the model")
        } finally {
          conn.disconnect()
        }
      }
      PeopleJob.schedule(context)
      true
    }

    /** App start while People is on: make sure the charging job is scheduled. */
    Function("ensureScheduled") { if (PeopleIndexer.modelFile(context).exists()) PeopleJob.schedule(context) }

    /** Off / "Delete all face data": stop the job, delete the database and the model. */
    AsyncFunction("disable") {
      PeopleJob.cancel(context)
      synchronized(PeopleIndexer) { FaceStore.deleteAll(context) }
      true
    }

    /** One pass now, whatever the charger says (self-test and testing only). */
    AsyncFunction("scanNow") { budgetSeconds: Int ->
      val r = PeopleIndexer.run(context, budgetSeconds * 1000L) { false } ?: return@AsyncFunction null
      mapOf("scanned" to r.scanned, "faces" to r.faces, "forgotten" to r.forgotten, "merged" to r.merged, "left" to r.left, "stoppedBy" to r.stoppedBy)
    }

    AsyncFunction("groups") { minPhotos: Int, includeHidden: Boolean ->
      synchronized(PeopleIndexer) { FaceStore.open(context).let { s -> try { s.listGroups(minPhotos, includeHidden) } finally { s.close() } } }
    }

    AsyncFunction("groupPhotos") { groupId: Long ->
      synchronized(PeopleIndexer) { FaceStore.open(context).let { s -> try { s.groupPhotos(groupId) } finally { s.close() } } }
    }

    AsyncFunction("asks") { limit: Int ->
      synchronized(PeopleIndexer) { FaceStore.open(context).let { s -> try { s.asks(limit) } finally { s.close() } } }
    }

    /** The face crop as a data URI (small JPEG; never leaves the phone). */
    AsyncFunction("faceThumb") { faceId: Long ->
      val bytes = synchronized(PeopleIndexer) { FaceStore.open(context).let { s -> try { s.thumb(faceId) } finally { s.close() } } }
      bytes?.let { "data:image/jpeg;base64," + Base64.encodeToString(it, Base64.NO_WRAP) }
    }

    AsyncFunction("rename") { groupId: Long, name: String? -> withStore { it.setName(groupId, name) } }
    AsyncFunction("setContact") { groupId: Long, contactId: String? -> withStore { it.setContact(groupId, contactId) } }
    AsyncFunction("hide") { groupId: Long, hidden: Boolean -> withStore { it.setHidden(groupId, hidden) } }
    AsyncFunction("merge") { keep: Long, other: Long -> PeopleActions.merge(context, keep, other) }
    AsyncFunction("notSame") { a: Long, b: Long -> PeopleActions.notSame(context, a, b) }
    AsyncFunction("notThis") { faceId: Long -> PeopleActions.notThis(context, faceId) }
    AsyncFunction("confirm") { faceId: Long, groupId: Long -> PeopleActions.confirm(context, faceId, groupId) }
    AsyncFunction("reject") { faceId: Long, groupId: Long -> PeopleActions.reject(context, faceId, groupId) }
  }

  private fun withStore(block: (FaceStore) -> Unit) = synchronized(PeopleIndexer) {
    val s = FaceStore.open(context)
    try { block(s) } finally { s.close() }
  }
}
