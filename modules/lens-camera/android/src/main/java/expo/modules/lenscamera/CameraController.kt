package expo.modules.lenscamera

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.CaptureResult
import android.hardware.camera2.TotalCaptureResult
import android.hardware.camera2.params.ColorSpaceTransform
import android.hardware.camera2.params.RggbChannelVector
import android.util.Log
import android.os.SystemClock
import android.util.Range
import androidx.annotation.OptIn
import androidx.camera.camera2.interop.Camera2CameraControl
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.camera2.interop.CaptureRequestOptions
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.DynamicRange
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.MeteringPoint
import androidx.camera.core.Preview
import androidx.camera.core.SurfaceOrientedMeteringPointFactory
import androidx.camera.core.UseCaseGroup
import androidx.camera.extensions.ExtensionMode
import androidx.camera.extensions.ExtensionsManager
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.FallbackStrategy
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.core.content.ContextCompat
import androidx.exifinterface.media.ExifInterface
import androidx.lifecycle.LifecycleOwner
import expo.modules.lenscamera.imaging.Portrait
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt

/** Everything the JS side configures. Mirrors CameraConfig in the iOS module. */
data class CameraConfig(
  val position: String = "back",
  val lens: String = "wide",
  val mode: String = "photo",
  val videoResolution: String = "4k",
  val hdrVideo: Boolean = false,
  val fps: Int = 30,
  val stabilization: String = "cinematic",
  val torch: Boolean = false,
  val zoom: Double = 1.0,
  val exposureMode: String = "auto",
  val iso: Double = 0.0,
  val shutter: Double = 0.0,
  val ev: Double = 0.0,
  val whiteBalanceMode: String = "auto",
  val temperature: Double = 5500.0,
  val tint: Double = 0.0,
  val focusMode: String = "auto",
  val lensPosition: Double = 0.5,
  /** Photo mode: save RAW (DNG) where the camera supports it. */
  val raw: Boolean = false,
  /** Photo mode: Ultra HDR JPEG (Android 14+, where supported). */
  val hdrPhoto: Boolean = true,
  /**
   * Quality Lab only (docs/research/camera-quality.md): bind one of the phone
   * maker's extension modes ("auto", "hdr", "night", "bokeh", "faceRetouch")
   * in Photo mode, or "none".
   */
  val extension: String = "none",
  /** Quality Lab only: "quality" (default) or "latency" photo capture. */
  val captureMode: String = "quality",
) {
  val isVideo get() = mode == "video"
  val isNight get() = mode == "night"

  fun needsRebind(old: CameraConfig) =
    position != old.position || lens != old.lens || isVideo != old.isVideo || isNight != old.isNight ||
      mode != old.mode || raw != old.raw || hdrPhoto != old.hdrPhoto ||
      extension != old.extension || captureMode != old.captureMode ||
      (isVideo && (videoResolution != old.videoResolution || hdrVideo != old.hdrVideo || fps != old.fps || stabilization != old.stabilization))
}

class CameraException(message: String) : Exception(message)

/**
 * CameraX + Camera2 interop. Preview + ImageCapture in photo modes and
 * Preview + VideoCapture in video mode: two streams only, which every Android
 * camera supports at full frame rate (a third stream was what made the old
 * camera lag).
 */
@OptIn(ExperimentalCamera2Interop::class)
class CameraController(private val context: Context) {
  var onReady: ((Map<String, Any?>) -> Unit)? = null
  var onError: ((String, Boolean) -> Unit)? = null

  private val main = ContextCompat.getMainExecutor(context)
  private val io = Executors.newSingleThreadExecutor()

  private var provider: ProcessCameraProvider? = null
  /** Phone makers' own Night mode etc. (CameraX Extensions), if this phone has them. */
  private var extensions: ExtensionsManager? = null
  /** True while bound with the maker's Night mode. */
  private var nightExtension = false
  /** The maker's extension mode bound right now ("none" if none). */
  private var boundExtension = "none"
  private var profile: DeviceProfile? = null
  private var owner: LifecycleOwner? = null
  private var previewSurface: Preview.SurfaceProvider? = null

  private var camera: Camera? = null
  private var facts: CameraFacts? = null
  private var lens: LensOption? = null
  private var preview: Preview? = null
  private var imageCapture: ImageCapture? = null
  /** Output format the photo use case was bound with (JPEG, Ultra HDR or RAW). */
  private var photoFormat = ImageCapture.OUTPUT_FORMAT_JPEG
  private var videoCapture: VideoCapture<Recorder>? = null
  private var recording: Recording? = null
  private var config = CameraConfig()
  private var running = false
  private var targetRotation = android.view.Surface.ROTATION_0
  private var displayRotation = android.view.Surface.ROTATION_0
  /** What actually got bound after fallbacks (e.g. HDR dropped). */
  private var bound = BoundVideo()

  private data class BoundVideo(
    val hdr: Boolean = false,
    val fps: Int = 30,
    val stabilized: Boolean = false,
    /** Photo fallback: plain JPEG if the phone refuses Ultra HDR / RAW. */
    val plainPhoto: Boolean = false,
  )

  // Latest per-frame metadata from the camera, for the HUD and manual WB anchoring.
  @Volatile private var lastIso: Int? = null
  @Volatile private var lastExposureNs: Long? = null
  @Volatile private var lastFocusDiopters: Float? = null
  @Volatile private var lastGains: RggbChannelVector? = null
  @Volatile private var lastTransform: ColorSpaceTransform? = null
  @Volatile private var lastAdjusting = false
  private var wbAnchor: ColorTemperature.Anchor? = null
  private var wbAnchorTransform: ColorSpaceTransform? = null
  private var appliedRequestKey: String? = null

  fun setPreviewSurface(provider: Preview.SurfaceProvider) {
    previewSurface = provider
    preview?.surfaceProvider = provider
  }

  /** How the screen is rotated, so the viewfinder stays upright. */
  fun setDisplayRotation(rotation: Int) {
    if (rotation == displayRotation) return
    displayRotation = rotation
    preview?.targetRotation = rotation
  }

  // ---------- Lifecycle ----------

  fun start(owner: LifecycleOwner, initial: CameraConfig) {
    this.owner = owner
    config = initial
    running = true
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      if (!running) return@addListener
      try {
        val p = future.get()
        provider = p
        if (profile == null) profile = DeviceProfile(context, p)
        if (extensions != null) {
          bind()
          return@addListener
        }
        // Extensions take a moment to load; without them the camera works as before.
        val ext = ExtensionsManager.getInstanceAsync(context, p)
        ext.addListener({
          extensions = runCatching { ext.get() }.getOrNull()
          if (running) bind()
        }, main)
      } catch (e: Exception) {
        onError?.invoke("Camera could not start: ${e.message}", true)
      }
    }, main)
  }

  fun stop() {
    running = false
    recording?.stop()
    recording = null
    provider?.unbindAll()
    camera = null
    appliedRequestKey = null
  }

  fun release() {
    stop()
    io.shutdown()
  }

  fun update(next: CameraConfig) {
    val old = config
    config = next
    if (!running || provider == null) return
    if (next.needsRebind(old) && recording == null) bind() else applyLive()
  }

  fun setTargetRotation(rotation: Int) {
    targetRotation = rotation
    imageCapture?.targetRotation = rotation
    if (recording == null) videoCapture?.targetRotation = rotation
  }

  val deviceProfile get() = profile

  // ---------- Binding ----------

  private fun chooseCamera(): Pair<CameraFacts, LensOption?>? {
    val p = profile ?: return null
    if (config.position == "front") return (p.mainFront ?: p.mainBack)?.let { it to null }
    val main = p.mainBack ?: p.mainFront ?: return null
    val option = p.backLenses.firstOrNull { it.id == config.lens } ?: p.backLenses.firstOrNull { it.id == "wide" }
    return if (option?.camera != null) option.camera to option else main to option
  }

  private fun bind() {
    val p = provider ?: return
    val o = owner ?: return
    val (cam, option) = chooseCamera() ?: run {
      onError?.invoke("No camera found on this device.", true)
      return
    }
    facts = cam
    lens = option
    appliedRequestKey = null

    // Fallback chain: if the phone refuses a combination (HDR + 60 fps + stabilization
    // on a budget phone, say), drop the most demanding option and try again.
    val attempts = if (config.isVideo) {
      listOf(
        BoundVideo(config.hdrVideo, config.fps, config.stabilization != "off"),
        BoundVideo(false, config.fps, config.stabilization != "off"),
        BoundVideo(false, 30, config.stabilization != "off"),
        BoundVideo(false, 30, false),
      ).distinct()
    } else {
      listOf(BoundVideo(), BoundVideo(plainPhoto = true))
    }
    var lastError: Exception? = null
    val baseSelector = cam.info.cameraSelector
    val ext = extensions
    nightExtension = config.isNight && ext != null &&
      runCatching { ext.isExtensionAvailable(baseSelector, ExtensionMode.NIGHT) }.getOrDefault(false)
    // Quality Lab: one of the maker's modes in Photo mode, when the phone has it.
    val labMode = DeviceProfile.EXTENSION_MODES.firstOrNull { it.first == config.extension }?.second
      ?.takeIf { config.mode == "photo" && ext != null && runCatching { ext.isExtensionAvailable(baseSelector, it) }.getOrDefault(false) }
    boundExtension = when {
      labMode != null -> config.extension
      nightExtension -> "night"
      else -> "none"
    }
    val selector = when {
      labMode != null -> ext!!.getExtensionEnabledCameraSelector(baseSelector, labMode)
      nightExtension -> ext!!.getExtensionEnabledCameraSelector(baseSelector, ExtensionMode.NIGHT)
      else -> baseSelector
    }
    for (attempt in attempts) {
      try {
        p.unbindAll()
        val group = buildUseCases(cam, attempt)
        camera = p.bindToLifecycle(o, selector, group)
        bound = attempt
        applyLive()
        onReady?.invoke(capabilities())
        return
      } catch (e: Exception) {
        Log.w(TAG, "bind failed with $attempt", e)
        lastError = e
      }
    }
    onError?.invoke("Camera could not start: ${lastError?.message}", true)
  }

  private fun buildUseCases(cam: CameraFacts, video: BoundVideo): UseCaseGroup {
    val ratio = if (config.isVideo) AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY else AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY
    val previewBuilder = Preview.Builder()
      .setResolutionSelector(ResolutionSelector.Builder().setAspectRatioStrategy(ratio).build())
    // Night (our own merge): let auto exposure use slower frames for more light.
    // Photo modes: like the phone's own camera, let auto exposure drop to 15 fps
    // in dim light. A fixed 30 fps capped the shutter at 1/30 s, so indoors the
    // camera pushed ISO instead: dark, grainy (and smeared by noise reduction).
    val rate = when {
      config.isNight && !nightExtension -> nightFrameRate(cam)
      config.isVideo -> previewFrameRate(cam, video.fps)
      else -> photoFrameRate(cam) ?: previewFrameRate(cam, 30)
    }
    rate?.let { previewBuilder.setTargetFrameRate(it) }
    // Per-frame metadata (ISO, shutter, focus, white balance) for the HUD.
    Camera2Interop.Extender(previewBuilder).setSessionCaptureCallback(captureCallback)
    if (config.isVideo && video.stabilized && config.stabilization != "standard" &&
      runCatching { Preview.getPreviewCapabilities(cam.info).isStabilizationSupported }.getOrDefault(false)
    ) {
      // Preview stabilization stabilizes the recording too (what you see is what you get).
      previewBuilder.setPreviewStabilizationEnabled(true)
    }
    val preview = previewBuilder.setTargetRotation(displayRotation).build()
    previewSurface?.let { preview.surfaceProvider = it }
    this.preview = preview

    val group = UseCaseGroup.Builder().addUseCase(preview)
    if (config.isVideo) {
      val caps = Recorder.getVideoCapabilities(cam.info)
      val range = if (video.hdr && DynamicRange.HLG_10_BIT in caps.supportedDynamicRanges) DynamicRange.HLG_10_BIT else DynamicRange.SDR
      val wanted = if (config.videoResolution == "4k") Quality.UHD else Quality.FHD
      val recorder = Recorder.Builder()
        .setQualitySelector(QualitySelector.from(wanted, FallbackStrategy.lowerQualityOrHigherThan(wanted)))
        .build()
      val builder = VideoCapture.Builder(recorder).setDynamicRange(range).setTargetRotation(targetRotation)
      if (video.fps != 30) videoFrameRate(cam, video.fps)?.let { builder.setTargetFrameRate(it) }
      if (video.stabilized && caps.isStabilizationSupported) builder.setVideoStabilizationEnabled(true)
      videoCapture = builder.build().also { group.addUseCase(it) }
      imageCapture = null
    } else {
      photoFormat = if (video.plainPhoto) ImageCapture.OUTPUT_FORMAT_JPEG else choosePhotoFormat(cam)
      imageCapture = ImageCapture.Builder()
        // Night bursts need quick successive shots; everything else, best quality.
        .setCaptureMode(
          if ((config.isNight && !nightExtension) || config.captureMode == "latency") ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY
          else ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY,
        )
        // 95 in every mode (CameraX would use 85 for quick captures, e.g. Night frames).
        .setJpegQuality(95)
        .setOutputFormat(photoFormat)
        .setResolutionSelector(
          ResolutionSelector.Builder()
            .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
            .setResolutionStrategy(ResolutionStrategy.HIGHEST_AVAILABLE_STRATEGY)
            .build(),
        )
        .setTargetRotation(targetRotation)
        .build()
        .also { group.addUseCase(it) }
      videoCapture = null
    }
    return group.build()
  }

  private fun photoFormats(cam: CameraFacts): Set<Int> =
    runCatching { ImageCapture.getImageCaptureCapabilities(cam.info).supportedOutputFormats }.getOrDefault(emptySet())

  /**
   * RAW (DNG) when asked for in Photo mode; otherwise Ultra HDR where the phone
   * supports it (more highlight/shadow range on HDR screens, a normal JPEG
   * everywhere else). Night and Portrait stay plain JPEG: their processing
   * (frame merge, embedded mask) works on standard JPEGs.
   */
  private fun choosePhotoFormat(cam: CameraFacts): Int {
    val formats = photoFormats(cam)
    return when {
      config.mode == "photo" && config.raw && ImageCapture.OUTPUT_FORMAT_RAW in formats -> ImageCapture.OUTPUT_FORMAT_RAW
      config.mode == "photo" && config.hdrPhoto && ImageCapture.OUTPUT_FORMAT_JPEG_ULTRA_HDR in formats -> ImageCapture.OUTPUT_FORMAT_JPEG_ULTRA_HDR
      else -> ImageCapture.OUTPUT_FORMAT_JPEG
    }
  }

  /** A steady frame rate (30 fps) so auto exposure doesn't slow the preview down. */
  private fun previewFrameRate(cam: CameraFacts, fps: Int): Range<Int>? {
    val ranges = runCatching { cam.info.supportedFrameRateRanges }.getOrNull().orEmpty()
    return ranges.firstOrNull { it.lower == fps && it.upper == fps }
      ?: ranges.filter { it.upper == fps }.maxByOrNull { it.lower }
  }

  /** Variable rate for photos: up to 30 fps, down to 15 fps (not lower: hand shake). */
  private fun photoFrameRate(cam: CameraFacts): Range<Int>? {
    val ranges = runCatching { cam.info.supportedFrameRateRanges }.getOrNull().orEmpty()
    return ranges.filter { it.upper == 30 && it.lower >= 15 && it.lower < 30 }.minByOrNull { it.lower }
  }

  private fun nightFrameRate(cam: CameraFacts): Range<Int>? {
    val ranges = runCatching { cam.info.supportedFrameRateRanges }.getOrNull().orEmpty()
    return ranges.filter { it.upper in 24..30 }.minByOrNull { it.lower }
  }

  private fun videoFrameRate(cam: CameraFacts, fps: Int): Range<Int>? {
    val ranges = runCatching { cam.info.supportedFrameRateRanges }.getOrNull().orEmpty()
    return ranges.firstOrNull { it.lower == fps && it.upper == fps } ?: ranges.firstOrNull { it.upper == fps }
  }

  // ---------- Live settings ----------

  private fun baseRatio(): Float = lens?.takeIf { it.camera == null }?.zoomRatio ?: 1f

  private fun applyLive() {
    val cam = camera ?: return
    val f = facts ?: return
    val zoomState = cam.cameraInfo.zoomState.value
    if (zoomState != null) {
      val target = (baseRatio() * config.zoom).toFloat().coerceIn(zoomState.minZoomRatio, zoomState.maxZoomRatio)
      if (kotlin.math.abs(target - zoomState.zoomRatio) > 0.001f) cam.cameraControl.setZoomRatio(target)
    }
    if (f.hasFlash) cam.cameraControl.enableTorch(config.torch && config.isVideo)

    val exposure = cam.cameraInfo.exposureState
    if (config.exposureMode != "manual" && exposure.isExposureCompensationSupported) {
      val step = exposure.exposureCompensationStep.toDouble()
      if (step > 0) {
        val index = (config.ev / step).roundToInt().coerceIn(exposure.exposureCompensationRange.lower, exposure.exposureCompensationRange.upper)
        if (index != exposure.exposureCompensationIndex) cam.cameraControl.setExposureCompensationIndex(index)
      }
    }
    // The maker's Night mode controls exposure itself.
    if (!nightExtension) applyRequestOptions(cam, f)
  }

  /** Manual exposure, white balance and focus through Camera2 request keys. */
  private fun applyRequestOptions(cam: Camera, f: CameraFacts) {
    val b = CaptureRequestOptions.Builder()
    val parts = mutableListOf<String>()

    if (config.exposureMode == "manual" && f.canManualExposure) {
      val iso = (if (config.iso > 0) config.iso.roundToInt() else lastIso ?: 100).coerceIn(f.isoRange!!.lower, f.isoRange.upper)
      val ns = (if (config.shutter > 0) (config.shutter * 1e9).toLong() else lastExposureNs ?: 8_000_000L)
        .coerceIn(f.exposureRangeNs!!.lower, f.exposureRangeNs.upper)
      b.setCaptureRequestOption(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_OFF)
      b.setCaptureRequestOption(CaptureRequest.SENSOR_SENSITIVITY, iso)
      b.setCaptureRequestOption(CaptureRequest.SENSOR_EXPOSURE_TIME, ns)
      // Long exposures need a long frame; never shorter than the exposure itself.
      b.setCaptureRequestOption(CaptureRequest.SENSOR_FRAME_DURATION, maxOf(ns, 33_333_333L))
      parts += "ae:$iso:$ns"
    }

    if (config.whiteBalanceMode == "manual" && f.canManualWhiteBalance) {
      val transform = wbAnchorTransform ?: lastTransform
      if (f.manualPostProcessing && transform != null) {
        if (wbAnchor == null) {
          // Anchor on what auto white balance was doing, so switching to manual doesn't jump.
          wbAnchor = lastGains?.let { ColorTemperature.anchor(it.toGains(), transform.toArray()) }
          wbAnchorTransform = transform
        }
        val g = ColorTemperature.manualGains(config.temperature, config.tint, transform.toArray(), wbAnchor)
        b.setCaptureRequestOption(CaptureRequest.CONTROL_AWB_MODE, CaptureRequest.CONTROL_AWB_MODE_OFF)
        b.setCaptureRequestOption(CaptureRequest.COLOR_CORRECTION_MODE, CaptureRequest.COLOR_CORRECTION_MODE_TRANSFORM_MATRIX)
        b.setCaptureRequestOption(CaptureRequest.COLOR_CORRECTION_GAINS, RggbChannelVector(g.r.toFloat(), g.g.toFloat(), g.g.toFloat(), g.b.toFloat()))
        b.setCaptureRequestOption(CaptureRequest.COLOR_CORRECTION_TRANSFORM, transform)
        parts += "wb:${config.temperature.roundToInt()}:${config.tint}"
      } else {
        ColorTemperature.nearestPreset(config.temperature, f.awbPresets)?.let { preset ->
          b.setCaptureRequestOption(CaptureRequest.CONTROL_AWB_MODE, CameraFacts.awbModeFor(preset))
          parts += "awb:${preset.name}"
        }
      }
    } else {
      wbAnchor = null
      wbAnchorTransform = null
    }

    if (config.focusMode == "manual" && f.canManualFocus) {
      // lensPosition: 0 = closest … 1 = infinity (same meaning as on iOS).
      val diopters = ((1 - config.lensPosition.coerceIn(0.0, 1.0)) * f.minFocusDistance).toFloat()
      b.setCaptureRequestOption(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_OFF)
      b.setCaptureRequestOption(CaptureRequest.LENS_FOCUS_DISTANCE, diopters)
      parts += "af:$diopters"
    }

    val key = parts.joinToString("|")
    if (key == appliedRequestKey) return
    appliedRequestKey = key
    val control = Camera2CameraControl.from(cam.cameraControl)
    if (parts.isEmpty()) control.clearCaptureRequestOptions() else control.setCaptureRequestOptions(b.build())
  }

  private val captureCallback = object : CameraCaptureSession.CaptureCallback() {
    override fun onCaptureCompleted(session: CameraCaptureSession, request: CaptureRequest, result: TotalCaptureResult) {
      lastIso = result.get(CaptureResult.SENSOR_SENSITIVITY)
      lastExposureNs = result.get(CaptureResult.SENSOR_EXPOSURE_TIME)
      lastFocusDiopters = result.get(CaptureResult.LENS_FOCUS_DISTANCE)
      val awbMode = result.get(CaptureResult.CONTROL_AWB_MODE)
      if (awbMode == CaptureResult.CONTROL_AWB_MODE_AUTO) {
        lastGains = result.get(CaptureResult.COLOR_CORRECTION_GAINS)
        lastTransform = result.get(CaptureResult.COLOR_CORRECTION_TRANSFORM)
      }
      val ae = result.get(CaptureResult.CONTROL_AE_STATE)
      val af = result.get(CaptureResult.CONTROL_AF_STATE)
      lastAdjusting = ae == CaptureResult.CONTROL_AE_STATE_SEARCHING ||
        af == CaptureResult.CONTROL_AF_STATE_ACTIVE_SCAN || af == CaptureResult.CONTROL_AF_STATE_PASSIVE_SCAN
    }
  }

  // ---------- Capabilities & stats ----------

  fun capabilities(): Map<String, Any?> {
    val f = facts ?: return emptyMap()
    val cam = camera
    val zoom = cam?.cameraInfo?.zoomState?.value
    val base = baseRatio()
    val exposure = cam?.cameraInfo?.exposureState
    val step = exposure?.exposureCompensationStep?.toDouble() ?: 0.0
    val videoCaps = runCatching { Recorder.getVideoCapabilities(f.info) }.getOrNull()
    val fpsRanges = runCatching { f.info.supportedFrameRateRanges }.getOrNull().orEmpty()
    val lenses = if (config.position == "back") profile?.backLenses.orEmpty() else emptyList()
    return mapOf(
      "extension" to boundExtension,
      "photoFormat" to when (photoFormat) {
        ImageCapture.OUTPUT_FORMAT_RAW -> "raw"
        ImageCapture.OUTPUT_FORMAT_JPEG_ULTRA_HDR -> "ultraHdr"
        else -> "jpeg"
      },
      "position" to config.position,
      "lens" to (lens?.id ?: "wide"),
      "mode" to config.mode,
      "lenses" to lenses.map { mapOf("id" to it.id, "factor" to it.factor) },
      "minISO" to (f.isoRange?.lower ?: 50).toDouble(),
      "maxISO" to (f.isoRange?.upper ?: 3200).toDouble(),
      "minShutter" to (f.exposureRangeNs?.lower ?: 125_000L) / 1e9,
      "maxShutter" to minOf((f.exposureRangeNs?.upper ?: 1_000_000_000L) / 1e9, 1.0),
      "minEV" to (exposure?.exposureCompensationRange?.lower ?: 0) * step,
      "maxEV" to (exposure?.exposureCompensationRange?.upper ?: 0) * step,
      "minZoom" to ((zoom?.minZoomRatio ?: 1f) / base).toDouble(),
      "maxZoom" to (minOf(zoom?.maxZoomRatio ?: 1f, 20f) / base).toDouble(),
      "manualExposure" to f.canManualExposure,
      "manualFocus" to f.canManualFocus,
      "manualWhiteBalance" to f.canManualWhiteBalance,
      "raw" to (ImageCapture.OUTPUT_FORMAT_RAW in photoFormats(f)),
      "ultraHdr" to (ImageCapture.OUTPUT_FORMAT_JPEG_ULTRA_HDR in photoFormats(f)),
      "proRaw" to false,
      "appleLog" to false,
      "hdrVideo" to (videoCaps?.supportedDynamicRanges?.contains(DynamicRange.HLG_10_BIT) == true),
      "fps60" to fpsRanges.any { it.upper >= 60 },
      // Portrait masks come from on-phone segmentation, so every camera has it.
      "depth" to true,
      // Our own Night merge: fewer frames on slower phones. 0 with the maker's Night mode.
      "nightFrames" to if (nightExtension) 0 else when (profile?.tierOf(f)) {
        "pro" -> 8
        "standard" -> 6
        else -> 4
      },
      "nightExtension" to nightExtension,
      "flash" to f.hasFlash,
      "torch" to f.hasFlash,
      "modes" to listOf("photo", "video", "night", "portrait"),
      "tier" to profile?.tierOf(f),
      "sensorReadout" to f.readSensorSettings,
    )
  }

  fun stats(): Map<String, Any?>? {
    val cam = camera ?: return null
    val f = facts ?: return null
    val transform = lastTransform?.toArray() ?: ColorTemperature.IDENTITY
    val kelvin = if (config.whiteBalanceMode == "manual") config.temperature
    else lastGains?.let { ColorTemperature.estimateKelvin(it.toGains(), transform) } ?: config.temperature
    val diopters = lastFocusDiopters
    val lensPosition = if (diopters != null && f.minFocusDistance > 0) 1 - (diopters / f.minFocusDistance).coerceIn(0f, 1f).toDouble() else config.lensPosition
    val ratio = cam.cameraInfo.zoomState.value?.zoomRatio ?: 1f
    return mapOf(
      "iso" to (lastIso ?: config.iso.roundToInt()).toDouble(),
      "shutter" to (lastExposureNs?.let { it / 1e9 } ?: config.shutter),
      "temperature" to kelvin,
      "tint" to config.tint,
      "lensPosition" to lensPosition,
      "exposureOffset" to 0.0,
      "zoom" to (ratio / baseRatio()).toDouble(),
      "adjusting" to lastAdjusting,
      "recording" to (recording != null),
    )
  }

  // ---------- Commands ----------

  /** Tap to focus at a point given as fractions of the preview buffer. */
  fun focusAtBuffer(x: Float, y: Float) {
    val p = preview ?: return
    focusAt(SurfaceOrientedMeteringPointFactory(1f, 1f, p).createPoint(x, y))
  }

  fun focusAt(point: MeteringPoint) {
    val cam = camera ?: return
    val flags = if (config.focusMode == "manual" || (facts?.afModes?.size ?: 0) <= 1) {
      FocusMeteringAction.FLAG_AE
    } else {
      FocusMeteringAction.FLAG_AF or FocusMeteringAction.FLAG_AE
    }
    val action = FocusMeteringAction.Builder(point, flags).setAutoCancelDuration(5, TimeUnit.SECONDS).build()
    runCatching { cam.cameraControl.startFocusAndMetering(action) }
  }

  fun takePhoto(flash: String, done: (Result<Map<String, Any?>>) -> Unit) {
    val capture = imageCapture ?: return done(Result.failure(CameraException("The camera isn't ready for photos.")))
    capture.flashMode = when (flash) {
      "on" -> ImageCapture.FLASH_MODE_ON
      "auto" -> ImageCapture.FLASH_MODE_AUTO
      else -> ImageCapture.FLASH_MODE_OFF
    }
    val raw = photoFormat == ImageCapture.OUTPUT_FORMAT_RAW
    val file = File(outputDir(), "lens-${UUID.randomUUID()}.${if (raw) "dng" else "jpg"}")
    capture.takePicture(
      ImageCapture.OutputFileOptions.Builder(file).build(),
      io,
      object : ImageCapture.OnImageSavedCallback {
        override fun onImageSaved(output: ImageCapture.OutputFileResults) {
          val (w, h) = uprightSize(file)
          // Portrait: find the person and keep the mask inside the photo.
          val depth = !raw && config.mode == "portrait" && Portrait.addMask(file)
          done(Result.success(mapOf("uri" to "file://${file.absolutePath}", "width" to w, "height" to h, "raw" to raw, "depth" to depth)))
        }

        override fun onError(exception: ImageCaptureException) {
          done(Result.failure(CameraException(exception.message ?: "Capture failed")))
        }
      },
    )
  }

  /**
   * Night: with the maker's Night mode, one capture (the phone merges frames
   * itself). Otherwise a burst of [frames] shots merged by [NightMerge].
   */
  fun takeNightPhoto(frames: Int, hot: Boolean, done: (Result<Map<String, Any?>>) -> Unit) {
    if (nightExtension) return takePhoto("off", done)
    val capture = imageCapture ?: return done(Result.failure(CameraException("The camera isn't ready for photos.")))
    capture.flashMode = ImageCapture.FLASH_MODE_OFF
    // A hot phone does less work: fewer frames.
    val count = (if (hot) minOf(frames, 3) else frames).coerceIn(1, 8)
    val dir = File(outputDir(), "night-${UUID.randomUUID()}").apply { mkdirs() }
    val shots = mutableListOf<File>()
    fun next() {
      val file = File(dir, "${shots.size}.jpg")
      capture.takePicture(
        ImageCapture.OutputFileOptions.Builder(file).build(),
        io,
        object : ImageCapture.OnImageSavedCallback {
          override fun onImageSaved(output: ImageCapture.OutputFileResults) {
            shots += file
            // Next shot from the main thread, like the first.
            if (shots.size < count) return main.execute { next() }
            try {
              val result = File(outputDir(), "lens-night-${UUID.randomUUID()}.jpg")
              NightMerge.merge(shots, result)
              dir.deleteRecursively()
              val (w, h) = uprightSize(result)
              done(Result.success(mapOf("uri" to "file://${result.absolutePath}", "width" to w, "height" to h, "raw" to false, "depth" to false, "frames" to count)))
            } catch (e: Throwable) {
              dir.deleteRecursively()
              done(Result.failure(CameraException("Night photo failed: ${e.message}")))
            }
          }

          override fun onError(exception: ImageCaptureException) {
            dir.deleteRecursively()
            done(Result.failure(CameraException(exception.message ?: "Capture failed")))
          }
        },
      )
    }
    next()
  }

  /**
   * Quality Lab: [frames] shots back to back with the bound photo use case
   * (JPEG, Ultra HDR or RAW DNG), kept as they are (no merge) so pipelines can
   * be compared offline on identical input. Each frame reports when it was
   * saved and the sensor settings the preview was using at that moment.
   */
  fun takeBurst(frames: Int, done: (Result<Map<String, Any?>>) -> Unit) {
    val capture = imageCapture ?: return done(Result.failure(CameraException("The camera isn't ready for photos.")))
    capture.flashMode = ImageCapture.FLASH_MODE_OFF
    val count = frames.coerceIn(1, 16)
    val raw = photoFormat == ImageCapture.OUTPUT_FORMAT_RAW
    val dir = File(outputDir(), "burst-${UUID.randomUUID()}").apply { mkdirs() }
    val shots = mutableListOf<Map<String, Any?>>()
    val started = SystemClock.elapsedRealtime()
    fun next() {
      val file = File(dir, "${shots.size}.${if (raw) "dng" else "jpg"}")
      capture.takePicture(
        ImageCapture.OutputFileOptions.Builder(file).build(),
        io,
        object : ImageCapture.OnImageSavedCallback {
          override fun onImageSaved(output: ImageCapture.OutputFileResults) {
            shots += mapOf(
              "uri" to "file://${file.absolutePath}",
              "ms" to SystemClock.elapsedRealtime() - started,
              "iso" to lastIso,
              "exposureNs" to lastExposureNs,
              "focusDiopters" to lastFocusDiopters?.toDouble(),
            )
            if (shots.size < count) return main.execute { next() }
            done(Result.success(mapOf("frames" to shots.toList(), "raw" to raw, "extension" to boundExtension)))
          }

          override fun onError(exception: ImageCaptureException) {
            dir.deleteRecursively()
            done(Result.failure(CameraException(exception.message ?: "Capture failed")))
          }
        },
      )
    }
    next()
  }

  @SuppressLint("MissingPermission")
  fun startRecording(done: (Result<Map<String, Any?>>) -> Unit) {
    val capture = videoCapture ?: return done(Result.failure(CameraException("Switch to video mode to record.")))
    if (recording != null) return done(Result.failure(CameraException("Already recording.")))
    capture.targetRotation = targetRotation
    // <cache>/Camera: the same place upload-while-recording watches for the growing file.
    val dir = File(context.cacheDir, "Camera").apply { mkdirs() }
    val file = File(dir, "${UUID.randomUUID()}.mp4")
    val pending = capture.output.prepareRecording(context, FileOutputOptions.Builder(file).build())
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
      pending.withAudioEnabled()
    }
    recording = pending.start(main) { event ->
      if (event is VideoRecordEvent.Finalize) {
        recording = null
        val ok = !event.hasError() || event.error in OK_FINALIZE
        if (ok && file.exists() && file.length() > 0) {
          done(Result.success(mapOf("uri" to "file://${file.absolutePath}", "duration" to event.recordingStats.recordedDurationNanos / 1e9)))
        } else {
          done(Result.failure(CameraException(event.cause?.message ?: "Recording failed (code ${event.error})")))
        }
        // Settings that changed while recording (e.g. resolution) apply now.
        if (running) bind()
      }
    }
  }

  fun stopRecording() {
    recording?.stop()
  }

  // ---------- Helpers ----------

  private fun outputDir() = File(context.cacheDir, "LensCamera").apply { mkdirs() }

  /** Width/height as displayed (EXIF rotation applied). DNGs are sized from their tags. */
  private fun uprightSize(file: File): Pair<Int, Int> {
    val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.absolutePath, opts)
    val exif = runCatching { ExifInterface(file) }.getOrNull()
    var w = opts.outWidth
    var h = opts.outHeight
    if (w <= 0 || h <= 0) {
      w = exif?.getAttributeInt(ExifInterface.TAG_IMAGE_WIDTH, 0) ?: 0
      h = exif?.getAttributeInt(ExifInterface.TAG_IMAGE_LENGTH, 0) ?: 0
    }
    val rotation = exif?.rotationDegrees ?: 0
    return if (rotation % 180 == 0) w to h else h to w
  }

  companion object {
    private const val TAG = "LensCamera"
    private val OK_FINALIZE = setOf(
      VideoRecordEvent.Finalize.ERROR_NONE,
      VideoRecordEvent.Finalize.ERROR_FILE_SIZE_LIMIT_REACHED,
      VideoRecordEvent.Finalize.ERROR_DURATION_LIMIT_REACHED,
      VideoRecordEvent.Finalize.ERROR_SOURCE_INACTIVE,
    )
  }
}

fun RggbChannelVector.toGains() = ColorTemperature.Gains(red.toDouble(), ((greenEven + greenOdd) / 2).toDouble(), blue.toDouble())

fun ColorSpaceTransform.toArray(): DoubleArray = DoubleArray(9) { i -> getElement(i % 3, i / 3).toDouble() }
