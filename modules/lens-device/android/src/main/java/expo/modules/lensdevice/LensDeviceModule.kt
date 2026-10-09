package expo.modules.lensdevice

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Device signals Lens adapts to. Thermal level: Android's PowerManager thermal
 * status (API 29+), reduced to normal / warm / hot / critical.
 */
class LensDeviceModule : Module() {
  private var listener: PowerManager.OnThermalStatusChangedListener? = null

  private val power: PowerManager?
    get() = appContext.reactContext?.getSystemService(Context.POWER_SERVICE) as? PowerManager

  override fun definition() = ModuleDefinition {
    Name("LensDevice")
    Events("onThermalChange")

    Function("thermalLevel") { currentLevel() }

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
      val context = appContext.reactContext ?: return@Function
      context.stopService(Intent(context, BackupService::class.java))
    }

    OnStartObserving {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val l = PowerManager.OnThermalStatusChangedListener { status ->
          sendEvent("onThermalChange", mapOf("level" to toLevel(status)))
        }
        power?.addThermalStatusListener(l)
        listener = l
      }
    }

    OnStopObserving {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        listener?.let { power?.removeThermalStatusListener(it) }
      }
      listener = null
    }
  }

  private fun currentLevel(): String =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) toLevel(power?.currentThermalStatus ?: 0) else "normal"

  private fun toLevel(status: Int): String = when (status) {
    PowerManager.THERMAL_STATUS_NONE, PowerManager.THERMAL_STATUS_LIGHT -> "normal"
    PowerManager.THERMAL_STATUS_MODERATE -> "warm"
    PowerManager.THERMAL_STATUS_SEVERE -> "hot"
    else -> "critical" // CRITICAL, EMERGENCY, SHUTDOWN
  }
}
