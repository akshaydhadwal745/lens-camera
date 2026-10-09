package expo.modules.lenscamera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap

/**
 * LUT strips for the looks, as RGBA bytes ready for a GL texture. Prefers a
 * bundled asset (assets/looks/<id>.png, baked from the iOS implementation for
 * an exact match) and otherwise bakes the Kotlin definition in [LookLut].
 */
object LookStore {
  private val cache = ConcurrentHashMap<String, ByteArray>()

  fun strip(context: Context?, id: String): ByteArray? {
    if (id !in LookLut.IDS) return null
    return cache.getOrPut(id) { context?.let { fromAsset(it, id) } ?: LookLut.bakeStrip(id) }
  }

  private fun fromAsset(context: Context, id: String): ByteArray? = runCatching {
    val n = LookLut.SIZE
    context.assets.open("looks/$id.png").use { stream ->
      val bitmap = BitmapFactory.decodeStream(stream, null, BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.ARGB_8888 })
        ?: return@runCatching null
      if (bitmap.width != n * n || bitmap.height != n) return@runCatching null
      val buffer = ByteBuffer.allocate(n * n * n * 4)
      bitmap.copyPixelsToBuffer(buffer) // ARGB_8888 is stored as RGBA bytes
      bitmap.recycle()
      buffer.array()
    }
  }.getOrNull()
}
