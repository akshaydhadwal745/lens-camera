package expo.modules.lensdevice

import android.content.ContentResolver
import android.content.ContentUris
import android.net.Uri
import android.os.Build
import android.provider.MediaStore

/**
 * Automatic backup of the phone's own camera (src/lib/auto-backup.ts, opt-in): photos and videos
 * added to the camera folders (DCIM/…) since a time, oldest first. Only the camera folders: not
 * WhatsApp downloads, screenshots or other apps' pictures. Needs the gallery read permission
 * (GalleryCleanup.permissions). Images and videos are read from their own collections, which have the
 * same columns on every Android version Lens supports (Android 9's files table has no "duration").
 */
internal object GalleryWatch {
  fun since(resolver: ContentResolver, sinceMs: Long, limit: Int): List<Map<String, Any?>> {
    val images = query(resolver, MediaStore.Images.Media.EXTERNAL_CONTENT_URI, false, sinceMs, limit)
    val videos = query(resolver, MediaStore.Video.Media.EXTERNAL_CONTENT_URI, true, sinceMs, limit)
    return (images + videos).sortedBy { it["dateAdded"] as Long }.take(limit)
  }

  private fun query(resolver: ContentResolver, collection: Uri, video: Boolean, sinceMs: Long, limit: Int): List<Map<String, Any?>> {
    val pathColumn = if (Build.VERSION.SDK_INT >= 29) MediaStore.MediaColumns.RELATIVE_PATH else MediaStore.MediaColumns.DATA
    val projection = mutableListOf(
      MediaStore.MediaColumns._ID,
      MediaStore.MediaColumns.MIME_TYPE,
      MediaStore.MediaColumns.DISPLAY_NAME,
      MediaStore.MediaColumns.SIZE,
      MediaStore.MediaColumns.DATE_ADDED,
      MediaStore.Images.ImageColumns.DATE_TAKEN,
      MediaStore.MediaColumns.WIDTH,
      MediaStore.MediaColumns.HEIGHT,
      pathColumn,
    )
    if (video) projection.add(MediaStore.Video.VideoColumns.DURATION)
    // DATE_ADDED is in seconds. Android ≤ 9: DATA is the full path (…/DCIM/Camera/x.jpg).
    val selection = "${MediaStore.MediaColumns.DATE_ADDED} > ? AND $pathColumn LIKE ?"
    val args = arrayOf((sinceMs / 1000).toString(), if (Build.VERSION.SDK_INT >= 29) "DCIM/%" else "%/DCIM/%")
    val out = mutableListOf<Map<String, Any?>>()
    resolver.query(collection, projection.toTypedArray(), selection, args, "${MediaStore.MediaColumns.DATE_ADDED} ASC")?.use { c ->
      val id = c.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
      val mime = c.getColumnIndexOrThrow(MediaStore.MediaColumns.MIME_TYPE)
      val name = c.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME)
      val size = c.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE)
      val added = c.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_ADDED)
      val taken = c.getColumnIndexOrThrow(MediaStore.Images.ImageColumns.DATE_TAKEN)
      val width = c.getColumnIndexOrThrow(MediaStore.MediaColumns.WIDTH)
      val height = c.getColumnIndexOrThrow(MediaStore.MediaColumns.HEIGHT)
      val duration = if (video) c.getColumnIndexOrThrow(MediaStore.Video.VideoColumns.DURATION) else -1
      while (c.moveToNext() && out.size < limit) {
        val bytes = if (c.isNull(size)) 0L else c.getLong(size)
        // Still being written (a video recording right now): next scan.
        if (bytes <= 0L) continue
        val addedMs = c.getLong(added) * 1000
        out.add(
          mapOf(
            "uri" to ContentUris.withAppendedId(collection, c.getLong(id)).toString(),
            "mimeType" to c.getString(mime),
            "name" to c.getString(name),
            "size" to bytes.toDouble(),
            "dateTaken" to (if (c.isNull(taken) || c.getLong(taken) <= 0) addedMs else c.getLong(taken)).toDouble(),
            "dateAdded" to addedMs,
            "width" to (if (c.isNull(width)) null else c.getInt(width)),
            "height" to (if (c.isNull(height)) null else c.getInt(height)),
            "duration" to (if (duration < 0 || c.isNull(duration)) null else c.getLong(duration) / 1000.0),
          ),
        )
      }
    }
    return out
  }
}
