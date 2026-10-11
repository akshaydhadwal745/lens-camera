package expo.modules.lenscamera

import android.app.Activity
import android.view.KeyEvent
import android.view.Window

/**
 * Volume buttons (and the camera key, and Bluetooth selfie remotes, which send
 * volume up) take the picture while the camera is on screen, like the phone's
 * own camera. The window's key handler is wrapped only while attached, so
 * volume works normally on every other screen. Key repeats (holding the
 * button) are ignored: one press, one shot.
 */
class HardwareShutter(private val onPress: () -> Unit) {
  private var window: Window? = null
  private var base: Window.Callback? = null
  private var ours: Window.Callback? = null

  fun attach(activity: Activity) {
    val w = activity.window ?: return
    if (window === w && ours != null) return
    detach()
    val original = w.callback ?: return
    val wrapper = object : Window.Callback by original {
      override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode in KEYS) {
          if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) onPress()
          return true // consumed: no volume change while the camera is open
        }
        return original.dispatchKeyEvent(event)
      }
    }
    w.callback = wrapper
    window = w
    base = original
    ours = wrapper
  }

  fun detach() {
    val w = window
    // Only undo our own wrapper (something else may have wrapped it since).
    if (w != null && ours != null && w.callback === ours) w.callback = base
    window = null
    base = null
    ours = null
  }

  private companion object {
    val KEYS = setOf(KeyEvent.KEYCODE_VOLUME_UP, KeyEvent.KEYCODE_VOLUME_DOWN, KeyEvent.KEYCODE_CAMERA)
  }
}
