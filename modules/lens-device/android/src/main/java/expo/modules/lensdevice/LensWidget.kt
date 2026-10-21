package expo.modules.lensdevice

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

/** Home-screen widget: the Lens camera, one tap away (opens on the camera). */
class LensWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
    } ?: return
    val tap = PendingIntent.getActivity(context, 1, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    for (id in ids) {
      val views = RemoteViews(context.packageName, R.layout.lens_widget)
      views.setOnClickPendingIntent(R.id.lens_widget_root, tap)
      manager.updateAppWidget(id, views)
    }
  }
}
