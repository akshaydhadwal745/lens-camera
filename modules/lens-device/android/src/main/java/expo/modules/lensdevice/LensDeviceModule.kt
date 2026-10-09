package expo.modules.lensdevice

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import com.android.installreferrer.api.InstallReferrerClient
import com.android.installreferrer.api.InstallReferrerStateListener
import expo.modules.kotlin.Promise
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Device signals Lens adapts to. Thermal level: Android's PowerManager thermal
 * status (API 29+), reduced to normal / warm / hot / critical. Android 7–9 have
 * no thermal API, so the battery temperature stands in (checked every 30 s).
 */
class LensDeviceModule : Module() {
  private var listener: PowerManager.OnThermalStatusChangedListener? = null
  private val handler = Handler(Looper.getMainLooper())
  private var lastBatteryLevel: String? = null
  private val batteryPoll = object : Runnable {
    override fun run() {
      val level = batteryLevel()
      if (level != lastBatteryLevel) {
        lastBatteryLevel = level
        sendEvent("onThermalChange", mapOf("level" to level))
      }
      handler.postDelayed(this, 30_000)
    }
  }

  private val power: PowerManager?
    get() = appContext.reactContext?.getSystemService(Context.POWER_SERVICE) as? PowerManager

  override fun definition() = ModuleDefinition {
    Name("LensDevice")
    Events("onThermalChange")

    Function("thermalLevel") { currentLevel() }

    // Import from the phone's gallery: the user picks; we get links (no copies, no permission).
    lateinit var pickerLauncher: AppContextActivityResultLauncher<PickMediaInput, List<PickedMedia>>
    RegisterActivityContracts {
      pickerLauncher = registerForActivityResult(MediaPickerContract(this@LensDeviceModule))
    }
    AsyncFunction("pickMedia") Coroutine { max: Int ->
      pickerLauncher.launch(PickMediaInput(max)).map {
        mapOf(
          "uri" to it.uri,
          "mimeType" to it.mimeType,
          "name" to it.name,
          "size" to it.size?.toDouble(),
          "dateTaken" to it.dateTaken?.toDouble(),
          "width" to it.width,
          "height" to it.height,
          "duration" to it.durationMs?.let { ms -> ms / 1000.0 },
        )
      }
    }

    // Copies a picked gallery item into the app's own file (exact bytes) just before it uploads.
    // Returns the number of bytes copied.
    AsyncFunction("copyMedia") Coroutine { uri: String, destination: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("No context")
      val dest = java.io.File(android.net.Uri.parse(destination).path ?: destination)
      val partial = java.io.File(dest.path + ".part")
      kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        dest.parentFile?.mkdirs()
        val input = context.contentResolver.openInputStream(android.net.Uri.parse(uri))
          ?: throw java.io.FileNotFoundException("Can't open $uri")
        try {
          input.use { src -> partial.outputStream().use { out -> src.copyTo(out, 1 shl 20) } }
          if (!partial.renameTo(dest)) throw java.io.IOException("Could not save the copy")
        } catch (e: Exception) {
          partial.delete()
          throw e
        }
        dest.length().toDouble()
      }
    }

    // Is a picked gallery item still readable (not deleted, access not revoked)?
    Function("canRead") { uri: String ->
      val context = appContext.reactContext ?: return@Function false
      runCatching { context.contentResolver.openFileDescriptor(android.net.Uri.parse(uri), "r")?.use { true } ?: false }.getOrDefault(false)
    }

    // Background backup (foreground service). Must be started while the app is
    // in the foreground (Android 12+ rule); returns false if Android refused.
    Function("startBackup") { text: String ->
      val context = appContext.reactContext ?: return@Function false
      try {
        val intent = Intent(context, BackupService::class.java).putExtra(BackupService.EXTRA_TEXT, text)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
        true
      } catch (e: Exception) {
        false
      }
    }

    Function("updateBackup") { text: String, progress: Int ->
      val context = appContext.reactContext ?: return@Function
      if (!BackupService.running) return@Function
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.notify(BackupService.NOTIFICATION_ID, BackupService.notification(context, text, progress))
    }

    Function("stopBackup") {
      appContext.reactContext?.let { context ->
        context.stopService(Intent(context, BackupService::class.java))
      }
      Unit
    }

    // Play Install Referrer (e.g. "lens_ref=ABCD234&utm_source=…"), read once on
    // first launch; null when not installed from Play or Play is unavailable.
    AsyncFunction("installReferrer") { promise: Promise ->
      val context = appContext.reactContext ?: return@AsyncFunction promise.resolve(null)
      val client = InstallReferrerClient.newBuilder(context).build()
      var settled = false
      fun settle(value: String?) {
        if (settled) return
        settled = true
        promise.resolve(value)
        try { client.endConnection() } catch (_: Exception) {}
      }
      try {
        client.startConnection(object : InstallReferrerStateListener {
          override fun onInstallReferrerSetupFinished(code: Int) {
            settle(
              if (code == InstallReferrerClient.InstallReferrerResponse.OK) {
                try { client.installReferrer.installReferrer } catch (_: Exception) { null }
              } else null,
            )
          }
          override fun onInstallReferrerServiceDisconnected() = settle(null)
        })
        handler.postDelayed({ settle(null) }, 5_000)
      } catch (_: Exception) {
        settle(null)
      }
    }

    // Emulator heuristics (referral rewards ignore emulators). Not proof: Play Integrity later.
    Function("isEmulator") {
      val fp = Build.FINGERPRINT.lowercase()
      fp.startsWith("generic") || fp.contains("emulator") || fp.contains("sdk_gphone") ||
        Build.MODEL.contains("Emulator") || Build.MODEL.contains("Android SDK built for") ||
        Build.HARDWARE.contains("goldfish") || Build.HARDWARE.contains("ranchu") ||
        Build.PRODUCT.contains("sdk") || Build.MANUFACTURER.contains("Genymotion") ||
        (Build.BRAND.startsWith("generic") && Build.DEVICE.startsWith("generic"))
    }

    OnStartObserving {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val l = PowerManager.OnThermalStatusChangedListener { status ->
          sendEvent("onThermalChange", mapOf("level" to toLevel(status)))
        }
        power?.addThermalStatusListener(l)
        listener = l
      } else {
        lastBatteryLevel = null
        handler.post(batteryPoll)
      }
    }

    OnStopObserving {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        listener?.let { power?.removeThermalStatusListener(it) }
      }
      handler.removeCallbacks(batteryPoll)
      listener = null
    }
  }

  private fun currentLevel(): String =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) toLevel(power?.currentThermalStatus ?: 0) else batteryLevel()

  /** Battery temperature (tenths of °C) as a heat level, for phones without the thermal API. */
  private fun batteryLevel(): String {
    val context = appContext.reactContext ?: return "normal"
    val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return "normal"
    val celsius = intent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) / 10.0
    return when {
      celsius >= 46 -> "critical"
      celsius >= 43 -> "hot"
      celsius >= 40 -> "warm"
      else -> "normal"
    }
  }

  private fun toLevel(status: Int): String = when (status) {
    PowerManager.THERMAL_STATUS_NONE, PowerManager.THERMAL_STATUS_LIGHT -> "normal"
    PowerManager.THERMAL_STATUS_MODERATE -> "warm"
    PowerManager.THERMAL_STATUS_SEVERE -> "hot"
    else -> "critical" // CRITICAL, EMERGENCY, SHUTDOWN
  }
}
