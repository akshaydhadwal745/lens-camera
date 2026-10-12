package expo.modules.lensdevice

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log

/**
 * Nearby Lens users on the same Wi-Fi (docs/design/organise-and-share.md, step 3).
 * The network only ever carries a short-lived random code (the mDNS service
 * name), never a name or account id: our server turns codes into display
 * names, and only for people who turned "Visible to nearby Lens users" on.
 * Runs only while the app asks (roll / share screen open), so no background
 * battery use. Android's NsdManager does the mDNS work (no extra permission).
 */
class NearbyDiscovery(context: Context, private val onCodes: (List<String>) -> Unit) {
  private val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
  private var registration: NsdManager.RegistrationListener? = null
  private var discovery: NsdManager.DiscoveryListener? = null
  private val seen = linkedSetOf<String>()

  /** Announces [code] (when visible) and listens for other phones' codes. */
  @Synchronized
  fun start(code: String?) {
    stop()
    if (code != null && CODE.matches(code)) {
      val info = NsdServiceInfo().apply {
        serviceName = code
        serviceType = SERVICE_TYPE
        // Nothing listens: the code itself is the whole message. Port 9 = "discard".
        port = 9
      }
      val listener = object : NsdManager.RegistrationListener {
        override fun onServiceRegistered(info: NsdServiceInfo) {
          Log.i(TAG, "visible as ${info.serviceName}")
        }
        override fun onRegistrationFailed(info: NsdServiceInfo, error: Int) {
          Log.w(TAG, "register failed $error")
        }
        override fun onServiceUnregistered(info: NsdServiceInfo) {}
        override fun onUnregistrationFailed(info: NsdServiceInfo, error: Int) {}
      }
      runCatching { nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener) }.onSuccess { registration = listener }
    }
    val listener = object : NsdManager.DiscoveryListener {
      override fun onDiscoveryStarted(type: String) {}
      override fun onDiscoveryStopped(type: String) {}
      override fun onStartDiscoveryFailed(type: String, error: Int) {
        Log.w(TAG, "discovery failed $error")
      }
      override fun onStopDiscoveryFailed(type: String, error: Int) {}
      override fun onServiceFound(info: NsdServiceInfo) {
        val name = info.serviceName ?: return
        if (CODE.matches(name) && name != code) changed { seen.add(name) }
      }
      override fun onServiceLost(info: NsdServiceInfo) {
        val name = info.serviceName ?: return
        changed { seen.remove(name) }
      }
    }
    runCatching { nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener) }.onSuccess { discovery = listener }
  }

  private fun changed(edit: () -> Boolean) {
    val list = synchronized(this) { if (edit()) seen.toList() else null } ?: return
    onCodes(list)
  }

  @Synchronized
  fun stop() {
    registration?.let { runCatching { nsd.unregisterService(it) } }
    discovery?.let { runCatching { nsd.stopServiceDiscovery(it) } }
    registration = null
    discovery = null
    if (seen.isNotEmpty()) {
      seen.clear()
      onCodes(emptyList())
    }
  }

  companion object {
    private const val TAG = "LensNearby"
    const val SERVICE_TYPE = "_lensnearby._tcp."
    /** Codes the server hands out: 16 url-safe characters. */
    val CODE = Regex("^[A-Za-z0-9_-]{16}$")
  }
}
