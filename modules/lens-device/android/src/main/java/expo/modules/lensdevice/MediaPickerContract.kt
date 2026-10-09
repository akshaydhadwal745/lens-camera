package expo.modules.lensdevice

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.ext.SdkExtensions
import android.provider.MediaStore
import android.provider.OpenableColumns
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.providers.AppContextProvider
import java.io.Serializable

internal data class PickMediaInput(val max: Int) : Serializable

/** One picked photo/video: a content:// link into the phone's gallery (no copy made). */
internal data class PickedMedia(
  val uri: String,
  val mimeType: String?,
  val name: String?,
  val size: Long?,
  val dateTaken: Long?,
  val width: Int?,
  val height: Int?,
  val durationMs: Long?,
)

/**
 * Lets the user choose photos/videos from their gallery. No storage permission:
 * Android's photo picker (Android 11+ with the update, or Google Play's backport)
 * returns read access to exactly what was chosen; older phones without either
 * get the system file chooser filtered to photos and videos. Access is made
 * persistable where Android allows, so uploads can resume after an app restart.
 */
@SuppressLint("WrongConstant", "NewApi")
internal class MediaPickerContract(private val appContextProvider: AppContextProvider) :
  AppContextActivityResultContract<PickMediaInput, List<PickedMedia>> {

  private val resolver: ContentResolver
    get() = requireNotNull(appContextProvider.appContext.reactContext) { "React Application Context is null" }.contentResolver

  override fun createIntent(context: Context, input: PickMediaInput): Intent {
    if (hasSystemPicker()) {
      val max = minOf(input.max, MediaStore.getPickImagesMaxLimit())
      return Intent(MediaStore.ACTION_PICK_IMAGES).apply {
        if (max > 1) putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, max)
      }
    }
    // Google Play services' backport of the photo picker (older Android versions).
    val gms = Intent(GMS_ACTION_PICK_IMAGES)
    if (gms.resolveActivity(context.packageManager) != null) {
      return gms.apply { if (input.max > 1) putExtra(GMS_EXTRA_PICK_IMAGES_MAX, minOf(input.max, GMS_MAX)) }
    }
    return Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "*/*"
      putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/*", "video/*"))
      putExtra(Intent.EXTRA_ALLOW_MULTIPLE, input.max > 1)
    }
  }

  override fun parseResult(input: PickMediaInput, resultCode: Int, intent: Intent?): List<PickedMedia> {
    if (resultCode != Activity.RESULT_OK || intent == null) return emptyList()
    val uris = mutableListOf<Uri>()
    val clip = intent.clipData
    if (clip != null) {
      for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let { uris.add(it) }
    } else {
      intent.data?.let { uris.add(it) }
    }
    return uris.distinct().mapNotNull { uri ->
      // Keep read access after a restart (uploads may take hours); not every source allows it.
      runCatching { resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
      describe(uri)
    }
  }

  private fun describe(uri: Uri): PickedMedia? {
    val mime = resolver.getType(uri)
    if (mime != null && !mime.startsWith("image/") && !mime.startsWith("video/")) return null
    var name: String? = null
    var size: Long? = null
    var taken: Long? = null
    var width: Int? = null
    var height: Int? = null
    var duration: Long? = null
    runCatching {
      resolver.query(uri, null, null, null, null)?.use { c ->
        if (!c.moveToFirst()) return@use
        fun long(col: String) = c.getColumnIndex(col).takeIf { it >= 0 && !c.isNull(it) }?.let { c.getLong(it) }
        name = c.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 }?.let { c.getString(it) }
        size = long(OpenableColumns.SIZE)
        // Photo picker / MediaStore columns; documents only have last_modified.
        taken = long(MediaStore.MediaColumns.DATE_TAKEN) ?: long("last_modified")
        width = long(MediaStore.MediaColumns.WIDTH)?.toInt()?.takeIf { it > 0 }
        height = long(MediaStore.MediaColumns.HEIGHT)?.toInt()?.takeIf { it > 0 }
        duration = long(MediaStore.MediaColumns.DURATION)?.takeIf { it > 0 }
      }
    }
    return PickedMedia(uri.toString(), mime, name, size, taken?.takeIf { it > 0 }, width, height, duration)
  }

  private fun hasSystemPicker(): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ||
      (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && SdkExtensions.getExtensionVersion(Build.VERSION_CODES.R) >= 2)

  companion object {
    private const val GMS_ACTION_PICK_IMAGES = "com.google.android.gms.provider.action.PICK_IMAGES"
    private const val GMS_EXTRA_PICK_IMAGES_MAX = "com.google.android.gms.provider.extra.PICK_IMAGES_MAX"
    private const val GMS_MAX = 100
  }
}
