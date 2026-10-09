package expo.modules.lensdevice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * Keeps Lens's uploads running when you leave the app or turn the screen off:
 * a foreground service (type dataSync) with a "Backing up…" notification, plus
 * a CPU wake lock and a Wi-Fi lock while it runs. The upload work itself stays
 * in the app (JS); this only keeps the process awake and visible to the user.
 */
class BackupService : Service() {
  companion object {
    const val CHANNEL_ID = "lens-backup"
    const val NOTIFICATION_ID = 4207
    const val EXTRA_TEXT = "text"
    const val EXTRA_PROGRESS = "progress"

    @Volatile var running = false

    fun notification(context: Context, text: String, progress: Int): Notification {
      ensureChannel(context)
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      val open = launch?.let {
        PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      }
      val builder =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(context, CHANNEL_ID)
        else @Suppress("DEPRECATION") Notification.Builder(context)
      builder
        .setSmallIcon(android.R.drawable.stat_sys_upload)
        .setContentTitle("Lens")
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setContentIntent(open)
      if (progress in 0..100) builder.setProgress(100, progress, false)
      return builder.build()
    }

    private fun ensureChannel(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (manager.getNotificationChannel(CHANNEL_ID) == null) {
        manager.createNotificationChannel(
          NotificationChannel(CHANNEL_ID, "Backup", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Shows while Lens uploads your photos and videos"
            setShowBadge(false)
          }
        )
      }
    }
  }

  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: "Backing up…"
    val progress = intent?.getIntExtra(EXTRA_PROGRESS, -1) ?: -1
    val n = notification(this, text, progress)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIFICATION_ID, n)
    }
    acquireLocks()
    running = true
    return START_NOT_STICKY
  }

  private fun acquireLocks() {
    if (wakeLock == null) {
      val power = getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Lens:backup").apply {
        setReferenceCounted(false)
        acquire(6 * 60 * 60 * 1000L) // safety cap; released when the backup ends
      }
    }
    if (wifiLock == null) {
      val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
      @Suppress("DEPRECATION")
      wifiLock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Lens:backup").apply {
        setReferenceCounted(false)
        acquire()
      }
    }
  }

  /** Android 15+: dataSync services get ~6 h/day; stop cleanly when told. */
  override fun onTimeout(startId: Int, fgsType: Int) {
    stopSelf()
  }

  override fun onDestroy() {
    running = false
    wakeLock?.let { if (it.isHeld) it.release() }
    wifiLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    wifiLock = null
    super.onDestroy()
  }
}
