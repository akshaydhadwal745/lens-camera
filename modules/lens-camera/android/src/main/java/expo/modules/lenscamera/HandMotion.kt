package expo.modules.lenscamera

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import kotlin.math.sqrt

/**
 * Is the phone being carried (walking, in a car) or standing still (tripod,
 * propped up)? Hyperlapse (checklist 9.5) uses it: a moving time-lapse takes
 * frames much more often so the motion stays smooth. Gyroscope where there is
 * one (how fast the phone turns), else the accelerometer's jitter. Smoothed over
 * ~2 s with hysteresis so a single bump doesn't flip it.
 */
class HandMotion(context: Context) : SensorEventListener {
  /** Changed (on the sensor thread). */
  var onChange: ((moving: Boolean) -> Unit)? = null

  @Volatile var moving = false
    private set

  private val sensors = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
  private val gyro = sensors.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
  private val accel = sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
  private var level = 0.0
  private var lastMagnitude = -1.0
  private var running = false

  fun start() {
    if (running) return
    running = true
    level = 0.0
    lastMagnitude = -1.0
    moving = false
    val sensor = gyro ?: accel ?: return
    sensors.registerListener(this, sensor, SensorManager.SENSOR_DELAY_GAME)
  }

  fun stop() {
    if (!running) return
    running = false
    sensors.unregisterListener(this)
  }

  override fun onSensorChanged(event: SensorEvent) {
    val (x, y, z) = Triple(event.values[0].toDouble(), event.values[1].toDouble(), event.values[2].toDouble())
    val magnitude = sqrt(x * x + y * y + z * z)
    // Gyro: turning speed (rad/s). Accelerometer: change in |g| between samples (jolts of walking).
    val sample = if (event.sensor.type == Sensor.TYPE_GYROSCOPE) magnitude else {
      val change = if (lastMagnitude < 0) 0.0 else kotlin.math.abs(magnitude - lastMagnitude) * 2
      lastMagnitude = magnitude
      change
    }
    // ~50 samples a second: this averages over roughly 2 s.
    level += (sample - level) * 0.01
    val now = if (moving) level > STILL_BELOW else level > MOVING_ABOVE
    if (now != moving) {
      moving = now
      onChange?.invoke(now)
    }
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

  companion object {
    /** Average turning speed (rad/s) above which the phone counts as carried. */
    const val MOVING_ABOVE = 0.15
    const val STILL_BELOW = 0.07
  }
}
