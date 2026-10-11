package expo.modules.lenscamera

import android.content.Context
import android.media.AudioManager
import android.media.MediaActionSound
import android.os.Build

/**
 * The system's own camera sounds (shutter click, record start/stop), played
 * when the photo really starts (CameraX `onCaptureStarted`), not on the press.
 * Plays when the user's setting is on and the phone isn't silent/vibrate, and
 * always where the law requires a shutter sound (Android 13+ tells us).
 */
class ShutterSound(private val context: Context) {
  private val sound = MediaActionSound().apply {
    load(MediaActionSound.SHUTTER_CLICK)
    load(MediaActionSound.START_VIDEO_RECORDING)
    load(MediaActionSound.STOP_VIDEO_RECORDING)
  }

  /** Setting (Settings → Camera → Shutter sound). */
  @Volatile var enabled = true

  private fun mustPlay(): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && MediaActionSound.mustPlayShutterSound()

  private fun allowed(): Boolean {
    if (mustPlay()) return true
    if (!enabled) return false
    val audio = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return true
    return audio.ringerMode == AudioManager.RINGER_MODE_NORMAL
  }

  fun shutter() {
    if (allowed()) sound.play(MediaActionSound.SHUTTER_CLICK)
  }

  fun recordStart() {
    if (allowed()) sound.play(MediaActionSound.START_VIDEO_RECORDING)
  }

  fun recordStop() {
    if (allowed()) sound.play(MediaActionSound.STOP_VIDEO_RECORDING)
  }

  fun release() = sound.release()
}
