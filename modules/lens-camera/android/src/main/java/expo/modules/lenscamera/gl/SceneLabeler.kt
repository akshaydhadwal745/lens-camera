package expo.modules.lenscamera.gl

import android.graphics.Bitmap
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.label.ImageLabeler
import com.google.mlkit.vision.label.ImageLabeling
import com.google.mlkit.vision.label.defaults.ImageLabelerOptions
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Smart look suggestion (checklist 5.3): what the viewfinder shows (ML Kit image
 * labeling via Google Play services: sunset, food, beach, snow…) mapped to one of
 * Lens's looks. Only a suggestion; the user taps to apply. Phones without Play
 * services (or before the model is downloaded) simply get none.
 * Frames: the ~320 px RGBA copy GlPreview already makes (bottom row first).
 */
class SceneLabeler {
  /** A stable suggestion changed (look id or null), on the labeling thread. */
  var onSuggestion: ((String?) -> Unit)? = null

  @Volatile var busy = false
    private set

  private val executor = Executors.newSingleThreadExecutor { Thread(it, "LensScene") }
  private var labeler: ImageLabeler? = null
  private var candidate: String? = null
  private var current: String? = null
  private var closed = false

  fun submit(rgba: ByteArray, width: Int, height: Int) {
    if (busy || closed) return
    busy = true
    executor.execute {
      try {
        val look = classify(rgba, width, height)
        // Same answer twice in a row before it shows (no flicker while panning).
        if (look == candidate && look != current) {
          current = look
          onSuggestion?.invoke(look)
        }
        candidate = look
      } catch (e: Exception) {
        Log.i(TAG, "scene labeling unavailable: ${e.message}")
      } finally {
        busy = false
      }
    }
  }

  fun reset() {
    executor.execute {
      candidate = null
      if (current != null) {
        current = null
        onSuggestion?.invoke(null)
      }
    }
  }

  fun close() {
    closed = true
    executor.execute {
      labeler?.close()
      labeler = null
    }
    executor.shutdown()
  }

  private fun classify(rgba: ByteArray, width: Int, height: Int): String? {
    // A black or featureless frame (lens covered, dark pocket, test rack) gets confident
    // nonsense labels ("sky" → Vivid, seen on Device Farm): suggest nothing.
    if (!recognisable(rgba)) return null
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
    val client = labeler ?: ImageLabeling.getClient(ImageLabelerOptions.DEFAULT_OPTIONS).also { labeler = it }
    val labels = Tasks.await(client.process(InputImage.fromBitmap(bitmap, 0)), 5, TimeUnit.SECONDS)
    bitmap.recycle()
    return lookFor(labels.filter { it.confidence >= MIN_CONFIDENCE }.map { it.text.lowercase() })
  }

  companion object {
    private const val TAG = "LensScene"
    const val MIN_CONFIDENCE = 0.7f

    /** Scene words → a look that suits them; first match wins (most specific first). */
    private val RULES = listOf(
      "golden" to listOf("sunset", "sunrise", "dusk", "afterglow"),
      "warm" to listOf("food", "dessert", "cake", "bread", "coffee", "pizza", "fruit", "candle", "cuisine"),
      "cool" to listOf("snow", "ice", "glacier", "winter", "ski"),
      "cinematic" to listOf("night", "neon", "city light", "concert", "fireworks"),
      "vivid" to listOf("flower", "plant", "garden", "beach", "sea", "lake", "mountain", "sky", "nature", "forest", "rainbow"),
    )

    /** Darker than this mean brightness (0–255) or flatter than this spread: nothing to recognise. */
    const val MIN_MEAN_LUMA = 18.0
    const val MIN_LUMA_SPREAD = 6.0

    /** Enough light and detail in the RGBA copy (every 4th pixel sampled) for a scene label to mean something. */
    fun recognisable(rgba: ByteArray): Boolean {
      var n = 0
      var sum = 0.0
      var sumSq = 0.0
      var i = 0
      while (i + 2 < rgba.size) {
        val y = 0.299 * (rgba[i].toInt() and 0xFF) + 0.587 * (rgba[i + 1].toInt() and 0xFF) + 0.114 * (rgba[i + 2].toInt() and 0xFF)
        sum += y
        sumSq += y * y
        n++
        i += 16
      }
      if (n == 0) return false
      val mean = sum / n
      val spread = Math.sqrt(maxOf(0.0, sumSq / n - mean * mean))
      return mean >= MIN_MEAN_LUMA && spread >= MIN_LUMA_SPREAD
    }

    fun lookFor(labels: List<String>): String? {
      for ((look, words) in RULES) {
        if (labels.any { label -> words.any { label.contains(it) } }) return look
      }
      return null
    }
  }
}
