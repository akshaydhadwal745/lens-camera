package expo.modules.lenscamera.people

import android.os.SystemClock
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * People (docs/design/people.md), Android only. Step 2: the face pipeline and a
 * benchmark the self-test runs on real phones (speed, heat, does LiteRT load).
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
  }
}
