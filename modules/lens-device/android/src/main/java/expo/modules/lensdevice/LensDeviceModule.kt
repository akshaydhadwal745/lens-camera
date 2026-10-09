package expo.modules.lensdevice

import android.content.Context
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
