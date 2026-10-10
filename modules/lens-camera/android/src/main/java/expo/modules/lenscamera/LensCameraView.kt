package expo.modules.lenscamera

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.display.DisplayManager
import android.os.Handler
import android.os.Looper
import android.view.OrientationEventListener
import android.view.Surface
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import expo.modules.lenscamera.gl.GlPreview

/** Monitoring overlays requested by JS (zebra, peaking, false colour, histogram). */
data class AnalysisOptions(
  val peaking: Boolean = false,
  val zebra: Boolean = false,
  val zebraLevel: Double = 0.95,
  val falseColor: Boolean = false,
  val histogram: Boolean = true,
)

/**
 * The camera view. Props arrive one by one; the camera is reconfigured once per
 * batch in [applyProps], like the iOS view.
 */
class LensCameraView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {

  private val onReady by EventDispatcher<Map<String, Any?>>()
  private val onStats by EventDispatcher<Map<String, Any?>>()
  private val onAnalysis by EventDispatcher<Map<String, Any?>>()
  private val onError by EventDispatcher<Map<String, Any?>>()
  private val onDiagnostics by EventDispatcher<Map<String, Any?>>()

  var config = CameraConfig()
  var analysis = AnalysisOptions()
  var active = true
  var look: String? = null
  var lookIntensity = 1.0

  private val controller = CameraController(context)
  /** GPU viewfinder with live looks and monitoring overlays. */
  private var glPreview: GlPreview? = GlPreview(context)
  /** Plain CameraX preview, used only if OpenGL fails on this phone. */
  private var previewView: PreviewView? = null
  private val handler = Handler(Looper.getMainLooper())
  private var running = false

  private val orientationListener = object : OrientationEventListener(context) {
    override fun onOrientationChanged(orientation: Int) {
      if (orientation == ORIENTATION_UNKNOWN) return
      // Device orientation -> rotation for captures, so photos come out upright
      // however the phone is held (the UI itself may be locked).
      val rotation = when (orientation) {
        in 45 until 135 -> Surface.ROTATION_270
        in 135 until 225 -> Surface.ROTATION_180
        in 225 until 315 -> Surface.ROTATION_90
        else -> Surface.ROTATION_0
      }
      controller.setTargetRotation(rotation)
    }
  }

  // Screen rotation. onSizeChanged alone misses a direct 180° turn
  // (landscape-left <-> landscape-right keeps the same size), which left the
  // viewfinder upside down.
  private val displayManager = context.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
  private val displayListener = object : DisplayManager.DisplayListener {
    override fun onDisplayAdded(displayId: Int) = Unit
    override fun onDisplayRemoved(displayId: Int) = Unit
    override fun onDisplayChanged(displayId: Int) {
      val d = display ?: return
      if (d.displayId == displayId) controller.setDisplayRotation(d.rotation)
    }
  }

  private val statsTick = object : Runnable {
    override fun run() {
      controller.stats()?.let { onStats(it) }
      handler.postDelayed(this, 250)
    }
  }

  init {
    // No background: the SurfaceView shows through a hole in the window, and an
    // opaque background here would cover it.
    glPreview!!.let { gl ->
      addView(gl.view, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
      controller.setPreviewSurface(gl)
      gl.onHistogram = { bins, low, high ->
        onAnalysis(mapOf("histogram" to bins.toList(), "clipLow" to low, "clipHigh" to high))
      }
      gl.onFailed = { message ->
        onDiagnostics(mapOf("kind" to "glFallback", "message" to message))
        usePlainPreview()
      }
      gl.onTransform = { details -> onDiagnostics(mapOf("kind" to "preview") + details) }
    }
    controller.onReady = { caps -> onReady(caps + mapOf("liveLooks" to (glPreview != null))) }
    controller.onError = { message, fatal -> onError(mapOf("message" to message, "fatal" to fatal)) }
  }

  /** React Native sizes this view but never measures its native children: do it here. */
  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    val w = r - l
    val h = b - t
    android.util.Log.i("LensPreview", "camera view layout ${w}x$h children $childCount attached $isAttachedToWindow")
    for (i in 0 until childCount) {
      val child = getChildAt(i)
      child.measure(MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY))
      child.layout(0, 0, w, h)
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    displayManager.registerDisplayListener(displayListener, handler)
    display?.let { controller.setDisplayRotation(it.rotation) }
    updateRunning()
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    displayManager.unregisterDisplayListener(displayListener)
    updateRunning()
  }

  fun applyProps() {
    glPreview?.let { gl ->
      gl.look = look
      gl.lookIntensity = lookIntensity
      gl.analysis = analysis
    }
    display?.let { controller.setDisplayRotation(it.rotation) }
    if (running) controller.update(config)
    updateRunning()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    // The UI rotated (or the view resized): keep the viewfinder upright.
    display?.let { controller.setDisplayRotation(it.rotation) }
  }

  /** OpenGL failed on this phone: plain preview without live looks/overlays. */
  private fun usePlainPreview() {
    val gl = glPreview ?: return
    glPreview = null
    removeView(gl.view)
    gl.release()
    val plain = PreviewView(context).apply {
      implementationMode = PreviewView.ImplementationMode.COMPATIBLE
      scaleType = PreviewView.ScaleType.FILL_CENTER
    }
    previewView = plain
    addView(plain, 0, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    controller.setPreviewSurface(plain.surfaceProvider)
  }

  fun destroy() {
    running = false
    handler.removeCallbacks(statsTick)
    orientationListener.disable()
    displayManager.unregisterDisplayListener(displayListener)
    controller.release()
    glPreview?.release()
    glPreview = null
  }

  private fun permitted() =
    ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

  private fun updateRunning() {
    val owner = appContext.currentActivity as? LifecycleOwner
    val shouldRun = isAttachedToWindow && active && permitted() && owner != null
    if (shouldRun && !running) {
      running = true
      controller.start(owner!!, config)
      if (orientationListener.canDetectOrientation()) orientationListener.enable()
      handler.post(statsTick)
    } else if (!shouldRun && running) {
      running = false
      controller.stop()
      orientationListener.disable()
      handler.removeCallbacks(statsTick)
    }
  }

  // ---------- Commands ----------

  fun takePhoto(flash: String, promise: Promise) {
    controller.takePhoto(flash) { result ->
      result.fold({ promise.resolve(it) }, { promise.reject("ERR_CAPTURE", it.message, it) })
    }
  }

  fun takeNightPhoto(frames: Int, promise: Promise) {
    controller.takeNightPhoto(frames, isHot()) { result ->
      result.fold({ promise.resolve(it) }, { promise.reject("ERR_CAPTURE", it.message, it) })
    }
  }

  fun takeBurst(frames: Int, promise: Promise) {
    controller.takeBurst(frames) { result ->
      result.fold({ promise.resolve(it) }, { promise.reject("ERR_CAPTURE", it.message, it) })
    }
  }

  /** Thermal status (0 none … 6 shutdown; -1 before Android 10), for the Quality Lab. */
  fun thermalStatus(): Int {
    val power = context.getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager ?: return -1
    return if (android.os.Build.VERSION.SDK_INT >= 29) power.currentThermalStatus else -1
  }

  private fun isHot(): Boolean {
    val power = context.getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager ?: return false
    return android.os.Build.VERSION.SDK_INT >= 29 && power.currentThermalStatus >= android.os.PowerManager.THERMAL_STATUS_SEVERE
  }

  fun startRecording(promise: Promise) {
    controller.startRecording { result ->
      result.fold({ promise.resolve(it) }, { promise.reject("ERR_RECORDING", it.message, it) })
    }
  }

  fun stopRecording() = controller.stopRecording()

  /** x/y are fractions of the view's size. */
  fun focus(x: Double, y: Double) {
    val gl = glPreview
    if (gl != null) {
      val (bx, by) = gl.viewToBuffer(x.toFloat(), y.toFloat())
      controller.focusAtBuffer(bx, by)
    } else {
      previewView?.let { controller.focusAt(it.meteringPointFactory.createPoint((x * width).toFloat(), (y * height).toFloat())) }
    }
  }
}
