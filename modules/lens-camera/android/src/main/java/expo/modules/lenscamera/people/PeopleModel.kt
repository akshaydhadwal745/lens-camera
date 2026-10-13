package expo.modules.lenscamera.people

import android.content.Context
import android.telephony.TelephonyManager
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.Locale

/**
 * People's face model and on/off state (docs/design/people.md).
 * - Turned on by the user: the model downloads right away (PeopleModule.enable).
 * - On by default (countries where that's allowed, decided in JS): only a small
 *   marker is written; the charging job downloads the model on Wi-Fi.
 * Everything lives in noBackupFilesDir/people, deleted by "turn off".
 */
object PeopleModel {
  private fun marker(context: Context) = File(FaceStore.dir(context), "auto.json")

  fun present(context: Context) = PeopleIndexer.modelFile(context).exists()

  /** On = model present, or on-by-default waiting for a charge on Wi-Fi. */
  fun isOn(context: Context) = present(context) || marker(context).exists()

  fun waitingForWifi(context: Context) = !present(context) && marker(context).exists()

  fun markAuto(context: Context, url: String, sha256: String) {
    FaceStore.dir(context).mkdirs()
    marker(context).writeText(JSONObject().put("url", url).put("sha256", sha256).toString())
  }

  /** The charging job: fetch the model if People is on by default and it isn't here yet. */
  fun downloadPending(context: Context): Boolean {
    if (present(context)) return true
    val m = runCatching { JSONObject(marker(context).readText()) }.getOrNull() ?: return false
    if (!FaceEmbedder.prepare(context)) return false
    return runCatching { download(context, m.getString("url"), m.getString("sha256")) }.isSuccess
  }

  /** Downloads into the no-backup folder and checks the SHA-256; throws with a plain message. */
  fun download(context: Context, url: String, sha256: String) {
    val model = PeopleIndexer.modelFile(context)
    if (model.exists()) return
    model.parentFile?.mkdirs()
    val tmp = File(model.parentFile, "${model.name}.part")
    val conn = URL(url).openConnection() as HttpURLConnection
    conn.connectTimeout = 15000; conn.readTimeout = 30000
    try {
      if (conn.responseCode != 200) throw IllegalStateException("The face model didn't download (${conn.responseCode}). Try again later.")
      val digest = MessageDigest.getInstance("SHA-256")
      conn.inputStream.use { input -> tmp.outputStream().use { out ->
        val buf = ByteArray(64 * 1024)
        while (true) { val n = input.read(buf); if (n < 0) break; digest.update(buf, 0, n); out.write(buf, 0, n) }
      } }
      val hex = digest.digest().joinToString("") { "%02x".format(it) }
      if (!hex.equals(sha256, ignoreCase = true)) { tmp.delete(); throw IllegalStateException("The face model download was damaged. Try again.") }
      if (!tmp.renameTo(model)) throw IllegalStateException("Couldn't save the face model.")
    } finally {
      conn.disconnect()
    }
  }

  /** Two-letter country: SIM, then mobile network, then the phone's language region. No permission needed. */
  fun country(context: Context): String {
    val tm = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
    val sim = runCatching { tm?.simCountryIso }.getOrNull()
    val net = runCatching { tm?.networkCountryIso }.getOrNull()
    return listOf(sim, net, Locale.getDefault().country).firstOrNull { !it.isNullOrBlank() && it.length == 2 }?.uppercase() ?: ""
  }
}
