package expo.modules.lenscamera

import android.hardware.camera2.CaptureRequest
import android.util.Log
import androidx.camera.core.CameraControl

/**
 * Auto-exposure mode on CameraX 1.6, which runs on camera-pipe.
 *
 * camera-pipe keeps CONTROL_AE_MODE and CONTROL_AE_LOCK in its own 3A state and writes
 * them into every request, so an AE mode or lock set through Camera2CameraControl never
 * reaches the camera: TorchControl writes "AE on" into that state on every bind and every
 * enableTorch call. Measured on the Galaxy S8 (2026-10-19): PRO asked for ISO 1250, the
 * request carried SENSOR_SENSITIVITY 1250 but AE_MODE ON, so the photo came out at ISO 320.
 *
 * The working route is the one CameraX's own low-light boost and torch use: the camera's
 * State3AControl preferred AE mode, then the request control's torch-off call, which
 * writes the final AE mode into camera-pipe's 3A state. Both are CameraX internals, reached
 * by reflection: CameraX is pinned to 1.6.0 and release builds aren't minified. Any failure
 * returns false and the camera keeps auto exposure.
 */
internal object PipeAe {
  private const val TAG = "LensPipeAe"
  private const val ADAPTER = "androidx.camera.camera2.adapter.CameraControlAdapter"

  /** [off] true = manual exposure (AE_MODE_OFF), false = back to CameraX's own AE mode. Call with the torch off. */
  fun setManual(control: CameraControl, off: Boolean): Boolean = runCatching {
    val torch = field(adapter(control) ?: return false, "torchControl") ?: return false
    val state3A = field(torch, "state3AControl") ?: return false
    state3A.javaClass.getMethod("setPreferredAeModeAsync", Integer::class.java)
      .invoke(state3A, if (off) CaptureRequest.CONTROL_AE_MODE_OFF else null)
    val mode = state3A.javaClass.getMethod("getFinalSupportedAeMode").invoke(state3A) as Int
    val requests = torch.javaClass.getMethod("getRequestControl").invoke(torch) ?: return false
    requests.javaClass.getMethod("setTorchOffAsync-MtizInI", Int::class.javaPrimitiveType).invoke(requests, mode)
    !off || mode == CaptureRequest.CONTROL_AE_MODE_OFF
  }.onFailure { Log.w(TAG, "AE mode not set: $it") }.getOrDefault(false)

  /** CameraX wraps its control (Camera.getCameraControl() → CameraControlInternal.getImplementation()). */
  private fun adapter(control: Any): Any? {
    var c: Any = control
    repeat(4) {
      if (c.javaClass.name == ADAPTER) return c
      c = runCatching { c.javaClass.getMethod("getImplementation").invoke(c) }.getOrNull()?.takeIf { it !== c } ?: return null
    }
    return null
  }

  private fun field(target: Any, name: String): Any? {
    var cls: Class<*>? = target.javaClass
    while (cls != null) {
      val c: Class<*> = cls
      runCatching { return c.getDeclaredField(name).apply { isAccessible = true }.get(target) }
      cls = c.superclass
    }
    return null
  }
}
