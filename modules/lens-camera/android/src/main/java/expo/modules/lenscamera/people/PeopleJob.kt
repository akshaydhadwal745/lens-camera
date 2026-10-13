package expo.modules.lenscamera.people

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.util.Log
import java.util.concurrent.atomic.AtomicBoolean

/**
 * People grouping runs only while the phone is charging and the battery isn't
 * low (docs/design/people.md: no heat in the pocket or while shooting).
 * Android's own JobScheduler: no extra library in the APK. Each run works for a
 * few minutes and the job repeats while charging until every photo is done.
 */
class PeopleJob : JobService() {
  private val stop = AtomicBoolean(false)
  private var worker: Thread? = null

  override fun onStartJob(params: JobParameters): Boolean {
    stop.set(false)
    worker = Thread {
      // On by default: the model arrives here, while charging on Wi-Fi.
      if (!PeopleModel.present(applicationContext)) PeopleModel.downloadPending(applicationContext)
      val stats = runCatching { PeopleIndexer.run(applicationContext, BUDGET_MS) { stop.get() } }
        .onFailure { Log.w(TAG, "pass failed", it) }
        .getOrNull()
      // More to do and not stopped by Android: run again soon (still only while charging).
      jobFinished(params, stats != null && stats.left > 0 && stats.stoppedBy == "time")
    }.apply { priority = Thread.MIN_PRIORITY; start() }
    return true
  }

  override fun onStopJob(params: JobParameters): Boolean {
    // Charger unplugged or Android needs the phone back: stop now, retry later.
    stop.set(true)
    return true
  }

  companion object {
    private const val TAG = "LensPeople"
    private const val JOB_ID = 0x1E05_0001
    private const val BUDGET_MS = 8 * 60 * 1000L

    /** Called when People is turned on and at every app start while it's on. */
    fun schedule(context: Context) {
      val scheduler = context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
      val needsWifi = !PeopleModel.present(context)
      val pending = scheduler.getPendingJob(JOB_ID)
      if (pending != null) {
        // Model arrived since: drop the Wi-Fi requirement (grouping itself needs no network).
        @Suppress("DEPRECATION")
        if ((pending.networkType != JobInfo.NETWORK_TYPE_NONE) == needsWifi) return
        scheduler.cancel(JOB_ID)
      }
      val job = JobInfo.Builder(JOB_ID, ComponentName(context, PeopleJob::class.java))
        .setRequiresCharging(true)
        // The model still has to download: only on Wi-Fi (unmetered), never mobile data.
        .setRequiredNetworkType(if (needsWifi) JobInfo.NETWORK_TYPE_UNMETERED else JobInfo.NETWORK_TYPE_NONE)
        .setRequiresBatteryNotLow(true)
        .setPeriodic(PERIOD_MS)
        .build()
      scheduler.schedule(job)
    }

    fun cancel(context: Context) {
      (context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler).cancel(JOB_ID)
    }

    /** Re-checks for new photos every 6 h while charging (Android may batch it later). */
    private const val PERIOD_MS = 6 * 60 * 60 * 1000L
  }
}
