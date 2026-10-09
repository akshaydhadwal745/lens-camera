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
