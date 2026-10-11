package expo.modules.lenscamera.gl

import android.graphics.Bitmap
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * QR codes in the camera (checklist 9.3): ML Kit barcode scanning (bundled, the
 * same library expo-camera already ships) on a ~640 px copy of the viewfinder a
 * couple of times a second. A code shows after it is read twice in a row and
 * goes away after a few reads without it, so a code at the edge doesn't flicker.
 * Frames: RGBA from glReadPixels (bottom row first).
 */
class QrScanner {
  /** A code appeared (its details) or went away (null), on the scanning thread. */
  var onCode: ((Map<String, Any?>?) -> Unit)? = null

  @Volatile var busy = false
    private set

  private val executor = Executors.newSingleThreadExecutor { Thread(it, "LensQr") }
  private var scanner: BarcodeScanner? = null
  private var candidate: String? = null
  private var current: String? = null
  private var misses = 0
  private var closed = false

  fun submit(rgba: ByteArray, width: Int, height: Int) {
    if (busy || closed) return
    busy = true
    executor.execute {
      try {
        val code = scan(rgba, width, height)
        val value = code?.get("value") as String?
        if (value != null) {
          misses = 0
          if (value == candidate && value != current) {
            current = value
            onCode?.invoke(code)
          }
          candidate = value
        } else if (current != null && ++misses >= 3) {
          current = null
          candidate = null
          onCode?.invoke(null)
        }
      } catch (e: Exception) {
        Log.i(TAG, "QR scanning unavailable: ${e.message}")
      } finally {
        busy = false
      }
    }
  }

  fun reset() {
    executor.execute {
      candidate = null
      misses = 0
      if (current != null) {
        current = null
        onCode?.invoke(null)
      }
    }
  }

  fun close() {
    closed = true
    executor.execute {
      scanner?.close()
      scanner = null
    }
    executor.shutdown()
  }

  private fun scan(rgba: ByteArray, width: Int, height: Int): Map<String, Any?>? {
    val pixels = IntArray(width * height)
    for (y in 0 until height) {
      val src = (height - 1 - y) * width * 4
      for (x in 0 until width) {
        val i = src + x * 4
        pixels[y * width + x] = (0xFF shl 24) or ((rgba[i].toInt() and 0xFF) shl 16) or
          ((rgba[i + 1].toInt() and 0xFF) shl 8) or (rgba[i + 2].toInt() and 0xFF)
      }
    }
    val bitmap = Bitmap.createBitmap(pixels, width, height, Bitmap.Config.ARGB_8888)
    val client = scanner ?: BarcodeScanning.getClient(
      BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build(),
    ).also { scanner = it }
    val codes = Tasks.await(client.process(InputImage.fromBitmap(bitmap, 0)), 3, TimeUnit.SECONDS)
    bitmap.recycle()
    // The biggest code in view: the one being pointed at.
    val code = codes.filter { !it.rawValue.isNullOrEmpty() }.maxByOrNull { b -> b.boundingBox?.let { it.width() * it.height() } ?: 0 }
      ?: return null
    return describe(code)
  }

  companion object {
    private const val TAG = "LensQr"

    private fun describe(b: Barcode): Map<String, Any?> {
      val raw = b.rawValue ?: ""
      return when (b.valueType) {
        Barcode.TYPE_URL -> mapOf("kind" to "url", "value" to raw, "url" to (b.url?.url ?: raw))
        Barcode.TYPE_WIFI -> mapOf("kind" to "wifi", "value" to raw, "ssid" to b.wifi?.ssid, "password" to b.wifi?.password)
        Barcode.TYPE_PHONE -> mapOf("kind" to "phone", "value" to raw, "phone" to b.phone?.number)
        Barcode.TYPE_EMAIL -> mapOf("kind" to "email", "value" to raw, "email" to b.email?.address)
        else -> kindOf(raw)
      }
    }

    /** Plain text that is really a link (some generators don't mark it as one). */
    fun kindOf(raw: String): Map<String, Any?> {
      val trimmed = raw.trim()
      return if (Regex("^https?://\\S+$", RegexOption.IGNORE_CASE).matches(trimmed)) {
        mapOf("kind" to "url", "value" to raw, "url" to trimmed)
      } else {
        mapOf("kind" to "text", "value" to raw)
      }
    }
  }
}
