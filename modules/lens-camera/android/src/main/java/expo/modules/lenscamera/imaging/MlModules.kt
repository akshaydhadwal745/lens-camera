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
  fun report(context: Context, install: Boolean, timeoutMs: Long): Map<String, Any?> {
    val code = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context)
    val out = mutableMapOf<String, Any?>("playServices" to (code == ConnectionResult.SUCCESS))
    if (code != ConnectionResult.SUCCESS) {
      out["playServicesCode"] = code
      return out
    }
    val client = ModuleInstall.getClient(context)
    val apis: List<Pair<String, OptionalModuleApi>> = listOf(
      "documentScanner" to GmsDocumentScanning.getClient(GmsDocumentScannerOptions.Builder().build()),
      "sceneLabels" to ImageLabeling.getClient(ImageLabelerOptions.DEFAULT_OPTIONS),
      "subjects" to SubjectSegmentation.getClient(SubjectSegmenterOptions.Builder().enableForegroundConfidenceMask().build()),
      "faces" to FaceDetection.getClient(FaceDetectorOptions.Builder().build()),
    )
    val deadline = SystemClock.elapsedRealtime() + timeoutMs
    try {
      for ((name, api) in apis) {
        val t0 = SystemClock.elapsedRealtime()
        val available = { Tasks.await(client.areModulesAvailable(api), 10, TimeUnit.SECONDS).areModulesAvailable() }
        val entry = try {
          if (available()) {
            mapOf("state" to "present")
          } else if (!install) {
            mapOf("state" to "missing")
          } else {
            Tasks.await(client.installModules(ModuleInstallRequest.newBuilder().addApi(api).build()), 15, TimeUnit.SECONDS)
            var done = available()
            while (!done && SystemClock.elapsedRealtime() < deadline) {
              Thread.sleep(1000)
              done = available()
            }
            mapOf("state" to if (done) "downloaded" else "download timed out", "ms" to SystemClock.elapsedRealtime() - t0)
          }
        } catch (e: Exception) {
          mapOf("state" to "error", "message" to (e.cause?.message ?: e.message))
        }
        out[name] = entry
      }
    } finally {
      for ((_, api) in apis) (api as? Closeable)?.let { runCatching { it.close() } }
    }
    return out
  }
}
