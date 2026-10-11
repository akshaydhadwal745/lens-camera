package expo.modules.lenscamera.imaging

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import java.io.File
import java.util.UUID

/**
 * Document scanning (checklist 9.4): Google's ML Kit document scanner (Play
 * services; nothing bundled). Its own full-screen flow finds the page edges,
 * flattens the perspective and cleans up shadows/stains; Lens gets JPEG pages
 * back and keeps them in its own files (the scanner's are temporary).
 */
object DocumentScan {
  const val REQUEST = 0x4C53 // "LS"

  private var pending: ((Result<List<Map<String, Any?>>>) -> Unit)? = null

  fun start(activity: Activity, done: (Result<List<Map<String, Any?>>>) -> Unit) {
    if (pending != null) return done(Result.failure(IllegalStateException("A scan is already open.")))
    val options = GmsDocumentScannerOptions.Builder()
      .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
      .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
      .setGalleryImportAllowed(false)
      .setPageLimit(20)
      .build()
    GmsDocumentScanning.getClient(options).getStartScanIntent(activity)
      .addOnSuccessListener { sender ->
        pending = done
        try {
          activity.startIntentSenderForResult(sender, REQUEST, null, 0, 0, 0)
        } catch (e: Exception) {
          pending = null
          done(Result.failure(e))
        }
      }
      .addOnFailureListener { done(Result.failure(IllegalStateException("Document scanning isn't available on this phone (${it.message}).", it))) }
  }

  /** The scanner closed: copy its pages into Lens's cache and report them (empty if cancelled). */
  fun onResult(context: Context, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != REQUEST) return
    val done = pending ?: return
    pending = null
    if (resultCode != Activity.RESULT_OK) return done(Result.success(emptyList()))
    done(
      runCatching {
        val result = GmsDocumentScanningResult.fromActivityResultIntent(data) ?: return@runCatching emptyList()
        val dir = File(context.cacheDir, "LensScan").apply { mkdirs() }
        result.pages.orEmpty().map { page -> copyPage(context, page.imageUri, File(dir, "scan-${UUID.randomUUID()}.jpg")) }
      },
    )
  }

  private fun copyPage(context: Context, uri: Uri, out: File): Map<String, Any?> {
    context.contentResolver.openInputStream(uri).use { input ->
      requireNotNull(input) { "Scanned page missing" }
      out.outputStream().use { input.copyTo(it) }
    }
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(out.path, bounds)
    return mapOf("uri" to "file://${out.absolutePath}", "width" to bounds.outWidth, "height" to bounds.outHeight)
  }
}
