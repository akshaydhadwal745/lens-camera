package expo.modules.lenscamera.imaging

import android.content.Context
import android.os.SystemClock
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.api.OptionalModuleApi
import com.google.android.gms.common.moduleinstall.ModuleInstall
import com.google.android.gms.common.moduleinstall.ModuleInstallRequest
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.mlkit.vision.label.ImageLabeling
import com.google.mlkit.vision.label.defaults.ImageLabelerOptions
import com.google.mlkit.vision.segmentation.subject.SubjectSegmentation
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenterOptions
import java.io.Closeable
import java.util.concurrent.TimeUnit

/**
 * The ML Kit models Lens gets from Google Play services (downloaded by the
 * phone, not in the APK): document scanner (9.4), scene labels (5.3), subjects
 * for Portrait (4.5) and faces for the burst pick (7.3). For the self-test:
 * whether each is on the phone, and (install = true) whether it downloads and
 * how long that takes. Must run off the main thread (it waits on tasks).
 */
object MlModules {
  private fun apis(): List<Pair<String, OptionalModuleApi>> = listOf(
    "documentScanner" to GmsDocumentScanning.getClient(GmsDocumentScannerOptions.Builder().build()),
    "sceneLabels" to ImageLabeling.getClient(ImageLabelerOptions.DEFAULT_OPTIONS),
    "subjects" to SubjectSegmentation.getClient(SubjectSegmenterOptions.Builder().enableForegroundConfidenceMask().build()),
    "faces" to FaceDetection.getClient(FaceDetectorOptions.Builder().build()),
  )

  private fun close(apis: List<Pair<String, OptionalModuleApi>>) {
    for ((_, api) in apis) (api as? Closeable)?.let { runCatching { it.close() } }
  }

  /**
   * App start: ask Play services to fetch any missing models in the background
   * (apps installed from the website don't get Play's install-time download), so
   * the scanner, scene suggestions and pet portraits are ready on first use.
   * Returns at once; Play services decides when (it prefers unmetered networks).
   */
  fun request(context: Context) {
    if (GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) != ConnectionResult.SUCCESS) return
    val apis = apis()
    val request = ModuleInstallRequest.newBuilder().apply { apis.forEach { addApi(it.second) } }.build()
    ModuleInstall.getClient(context).installModules(request).addOnCompleteListener { close(apis) }
  }

  fun report(context: Context, install: Boolean, timeoutMs: Long): Map<String, Any?> {
    val code = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context)
    val out = mutableMapOf<String, Any?>("playServices" to (code == ConnectionResult.SUCCESS))
    if (code != ConnectionResult.SUCCESS) {
      out["playServicesCode"] = code
      return out
    }
    val client = ModuleInstall.getClient(context)
    val apis = apis()
    val deadline = SystemClock.elapsedRealtime() + timeoutMs
    val t0 = SystemClock.elapsedRealtime()
    try {
      val available = { api: OptionalModuleApi -> Tasks.await(client.areModulesAvailable(api), 10, TimeUnit.SECONDS).areModulesAvailable() }
      val before = apis.associate { (name, api) -> name to runCatching { available(api) } }
      val missing = apis.filter { (name, _) -> before[name]?.getOrNull() == false }
      // One request for everything missing (Play services downloads them together), then wait for each.
      if (install && missing.isNotEmpty()) {
        runCatching {
          val request = ModuleInstallRequest.newBuilder().apply { missing.forEach { addApi(it.second) } }.build()
          Tasks.await(client.installModules(request), 15, TimeUnit.SECONDS)
        }
      }
      for ((name, api) in apis) {
        val first = before[name]!!
        out[name] = when {
          first.isFailure -> mapOf("state" to "error", "message" to (first.exceptionOrNull()?.cause?.message ?: first.exceptionOrNull()?.message))
          first.getOrNull() == true -> mapOf("state" to "present")
          !install -> mapOf("state" to "missing")
          else -> {
            var done = runCatching { available(api) }.getOrDefault(false)
            while (!done && SystemClock.elapsedRealtime() < deadline) {
              Thread.sleep(1000)
              done = runCatching { available(api) }.getOrDefault(false)
            }
            mapOf("state" to if (done) "downloaded" else "download timed out", "ms" to SystemClock.elapsedRealtime() - t0)
          }
        }
      }
    } finally {
      close(apis)
    }
    return out
  }
}
