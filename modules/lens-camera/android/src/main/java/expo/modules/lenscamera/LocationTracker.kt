package expo.modules.lenscamera

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat

/**
 * Where photos are taken (opt-in, Settings → Camera → Save location).
 * Android's own LocationManager (GPS + network), so it works without Google
 * Play services. Listens only while the camera is on screen and the option is
 * on; a fix older than [MAX_AGE_MS] is never used (no location beats a wrong one).
 */
class LocationTracker(private val context: Context) {
  private val manager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
  @Volatile private var best: Location? = null
  private var listening = false

  private val listener = LocationListener { location -> offer(location) }

  private fun permitted() =
    ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
      ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

  /** Start or stop listening (main thread). */
  @SuppressLint("MissingPermission")
  fun setActive(active: Boolean) {
    val m = manager ?: return
    if (active && !listening && permitted()) {
      for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
        if (!runCatching { m.isProviderEnabled(provider) }.getOrDefault(false)) continue
        runCatching { m.getLastKnownLocation(provider) }.getOrNull()?.let { offer(it) }
        // Every 5 s at most, and only while the camera is on screen. No distance filter: a
        // phone that stays put would get no new fix, and after MAX_AGE_MS its photos lost
        // their location (Galaxy S8, 2026-10-19: none after 10 min in one room). The receiver
        // runs at this interval anyway; the filter only dropped the callbacks.
        runCatching { m.requestLocationUpdates(provider, 5_000L, 0f, listener, Looper.getMainLooper()) }
          .onFailure { Log.w(TAG, "location updates from $provider failed", it) }
      }
      listening = true
    } else if (!active && listening) {
      runCatching { m.removeUpdates(listener) }
      listening = false
    }
  }

  /** The location to save with a photo/video now, or null if there's no recent one. */
  fun current(): Location? {
    val l = best ?: return null
    val ageMs = (SystemClock.elapsedRealtimeNanos() - l.elapsedRealtimeNanos) / 1_000_000
    return if (ageMs in 0..MAX_AGE_MS) l else null
  }

  /** Keep the better fix: newer by more than a minute, or more accurate. */
  private fun offer(location: Location) {
    val old = best
    best = when {
      old == null -> location
      location.elapsedRealtimeNanos - old.elapsedRealtimeNanos > 60_000_000_000L -> location
      location.accuracy <= old.accuracy -> location
      else -> old
    }
  }

  companion object {
    private const val TAG = "LensLocation"
    const val MAX_AGE_MS = 10 * 60 * 1000L
  }
}
