package expo.modules.lensdevice

import android.Manifest
import android.app.Activity
import android.content.ContentResolver
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts.StartIntentSenderForResult
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.providers.AppContextProvider
import java.io.Serializable
import java.security.MessageDigest

/**
 * Free up space (docs/design/switch-features.md §2): remove photos/videos from the
 * phone's gallery once Lens has a verified cloud copy. The app decides what is
 * safe (cloud copy confirmed, MD5 of the gallery file = what was uploaded); this
 * file only finds gallery items, hashes them and deletes them through Android's
 * own flow (one system confirmation on Android 11+, items go to the system trash).
 */
internal object GalleryCleanup {
  /** What reading (and on Android ≤ 10 deleting) the gallery needs on this Android version. */
  fun permissions(): Array<String> = when {
    Build.VERSION.SDK_INT >= 33 -> arrayOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO)
    Build.VERSION.SDK_INT >= 30 -> arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
    else -> arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE)
  }

  private val filesUri: Uri get() = MediaStore.Files.getContentUri("external")

  /**
   * Gallery items that could be the imported file: the picker's own id first (the
   * photo picker, Play's backport and the documents provider all carry the
   * MediaStore id at the end), then every photo/video with the same size taken
   * within 2 s. The caller confirms with the MD5. Needs the read permission.
   */
  fun find(resolver: ContentResolver, hint: String, size: Long, dateTaken: Long?): List<String> {
    val out = linkedSetOf<String>()
    idFrom(hint)?.let { id -> query(resolver, "${MediaStore.MediaColumns._ID} = ?", arrayOf(id.toString())).filter { it.second == size }.forEach { out += it.first } }
    if (hint.startsWith("content://media/external")) out += hint
    val sel = StringBuilder("${MediaStore.MediaColumns.SIZE} = ? AND ${MediaStore.Files.FileColumns.MEDIA_TYPE} IN (?, ?)")
    val args = mutableListOf(size.toString(), MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE.toString(), MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO.toString())
    if (dateTaken != null && dateTaken > 0) {
      sel.append(" AND ${MediaStore.MediaColumns.DATE_TAKEN} BETWEEN ? AND ?")
      args += (dateTaken - 2000).toString()
      args += (dateTaken + 2000).toString()
    }
    query(resolver, sel.toString(), args.toTypedArray()).take(5).forEach { out += it.first }
    return out.toList()
  }

  /** (content uri, size) of matching gallery rows, as per-type uris (what delete requests accept). */
  private fun query(resolver: ContentResolver, selection: String, args: Array<String>): List<Pair<String, Long>> {
    val cols = arrayOf(MediaStore.MediaColumns._ID, MediaStore.MediaColumns.SIZE, MediaStore.Files.FileColumns.MEDIA_TYPE)
    val rows = mutableListOf<Pair<String, Long>>()
    runCatching {
      resolver.query(filesUri, cols, selection, args, null)?.use { c ->
        while (c.moveToNext()) {
          val id = c.getLong(0)
          val base = if (c.getInt(2) == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO) {
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI
          } else {
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI
          }
          rows += ContentUris.withAppendedId(base, id).toString() to c.getLong(1)
        }
      }
    }
    return rows
  }

  /** The MediaStore id at the end of a picker / documents / media uri ("…/media/123", "image%3A123"). */
  private fun idFrom(hint: String): Long? {
    val last = Uri.decode(Uri.parse(hint).lastPathSegment ?: return null)
    return last.substringAfterLast(':').toLongOrNull()
  }

  /** MD5 of a content uri's bytes, lowercase hex (streamed, any size). */
  fun md5(resolver: ContentResolver, uri: String): String? = runCatching {
    val digest = MessageDigest.getInstance("MD5")
    resolver.openInputStream(Uri.parse(uri))?.use { input ->
      val buffer = ByteArray(1 shl 16)
      while (true) {
        val n = input.read(buffer)
        if (n < 0) break
        digest.update(buffer, 0, n)
      }
    } ?: return null
    digest.digest().joinToString("") { "%02x".format(it) }
  }.getOrNull()

  /** Still in the gallery? (After a delete: what really went.) */
  fun exists(resolver: ContentResolver, uri: String): Boolean = runCatching {
    resolver.query(Uri.parse(uri), arrayOf(MediaStore.MediaColumns._ID), null, null, null)?.use { it.moveToFirst() } ?: false
  }.getOrDefault(false)

  /** Android ≤ 10: delete directly (WRITE_EXTERNAL_STORAGE; legacy storage on Android 10). */
  fun deleteDirect(resolver: ContentResolver, uris: List<String>) {
    for (u in uris) runCatching { resolver.delete(Uri.parse(u), null, null) }
  }
}

internal data class GalleryDeleteInput(val uris: ArrayList<String>) : Serializable

/** Android 11+: the system's "Allow Lens to move these N items to trash?" confirmation. */
@android.annotation.SuppressLint("NewApi")
internal class GalleryDeleteContract(private val appContextProvider: AppContextProvider) :
  AppContextActivityResultContract<GalleryDeleteInput, Boolean> {

  override fun createIntent(context: Context, input: GalleryDeleteInput): Intent {
    val resolver = requireNotNull(appContextProvider.appContext.reactContext) { "React Application Context is null" }.contentResolver
    val pending = MediaStore.createDeleteRequest(resolver, input.uris.map(Uri::parse))
    return Intent(StartIntentSenderForResult.ACTION_INTENT_SENDER_REQUEST)
      .putExtra(StartIntentSenderForResult.EXTRA_INTENT_SENDER_REQUEST, IntentSenderRequest.Builder(pending.intentSender).build())
  }

  override fun parseResult(input: GalleryDeleteInput, resultCode: Int, intent: Intent?): Boolean = resultCode == Activity.RESULT_OK
}
