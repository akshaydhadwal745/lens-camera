package expo.modules.lenscamera

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.hardware.camera2.CameraCaptureSession
import android.graphics.ImageFormat
import android.hardware.camera2.CameraCharacteristics
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
import androidx.camera.core.LowLightBoostState
import androidx.camera.core.MirrorMode
import androidx.camera.core.SessionConfig
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
import androidx.camera.video.AudioStats
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.HighSpeedVideoSessionConfig
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
import expo.modules.lenscamera.imaging.PortraitStyle
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
  /** Front camera: save photos and videos as previewed (mirrored). Photos get a lossless EXIF flip. */
  val mirrorFront: Boolean = true,
  /** Opt-in: save where photos/videos were taken (needs location permission; see [LocationTracker]). */
  val saveLocation: Boolean = false,
  /** Camera sounds (shutter, record start/stop); see [ShutterSound] for when they still play/stay silent. */
  val shutterSound: Boolean = true,
  /**
   * Normal camera video: automatic low-light handling (checklist 3.6) — frame rate may
   * drop 30 → 24 fps in the dark, and the phone's low-light boost (Android 15+) is used
   * where it exists. PRO keeps the chosen fixed frame rate.
   */
  val autoLowLight: Boolean = false,
  /**
   * Quality Lab only (docs/research/camera-quality.md): bind one of the phone
   * maker's extension modes ("auto", "hdr", "night", "bokeh", "faceRetouch")
   * in Photo mode, or "none".
   */
  val extension: String = "none",
  /** Quality Lab only: "quality" (default) or "latency" photo capture. */
  val captureMode: String = "quality",
) {
  /** Video and slow motion record with VideoCapture. */
  val isVideo get() = mode == "video" || mode == "slowmo"
  val isSlowMo get() = mode == "slowmo"
  val isNight get() = mode == "night"
  val isTimeLapse get() = mode == "timelapse"

  fun needsRebind(old: CameraConfig) =
    position != old.position || lens != old.lens || isVideo != old.isVideo || isNight != old.isNight ||
      mode != old.mode || raw != old.raw || hdrPhoto != old.hdrPhoto ||
      extension != old.extension || captureMode != old.captureMode ||
      (isVideo && (videoResolution != old.videoResolution || hdrVideo != old.hdrVideo || fps != old.fps || stabilization != old.stabilization ||
        (position == "front" && mirrorFront != old.mirrorFront) || autoLowLight != old.autoLowLight))
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
  /** The first video data was recorded ([Long] = ms since record was pressed). The REC timer starts here. */
  var onRecordingStarted: ((Long) -> Unit)? = null
  /** Recording sound changed: "ok", "silenced" (mic blocked: privacy toggle / another app) or "error"; plus an external mic in use. */
  var onRecordingAudio: ((String, Boolean) -> Unit)? = null

  private val main = ContextCompat.getMainExecutor(context)
  private val io = Executors.newSingleThreadExecutor()

  private var provider: ProcessCameraProvider? = null
  /** Phone makers' own Night mode etc. (CameraX Extensions), if this phone has them. */
  private var extensions: ExtensionsManager? = null
  /** True while bound with the maker's Night mode. */
  private var nightExtension = false
  /** The phone maker's Night mode is bound (its preview is already processed). */
  val usesNightExtension get() = nightExtension
  /** The maker's extension mode bound right now ("none" if none). */
  private var boundExtension = "none"
  private var profile: DeviceProfile? = null
  private var owner: LifecycleOwner? = null
  private var previewSurface: Preview.SurfaceProvider? = null

  private var camera: Camera? = null
  private var facts: CameraFacts? = null
  /** Astro capture in progress: manual (ISO, exposure ns) overriding auto exposure. */
  private var astro: Pair<Int, Long>? = null
  private var lens: LensOption? = null
  private var preview: Preview? = null
  /** Cameras whose maker Night mode saves under half the full resolution: Lens Night instead. */
  private val smallNightExtension = mutableSetOf<String>()
  /**
   * Cameras whose maker extension never finished a photo (Device Farm Pixel 6:
   * maker Night hung the capture). Remembered on the phone: Lens Night from then on.
   */
  private val hungPrefs = context.getSharedPreferences("lens-camera", Context.MODE_PRIVATE)
  private val hungExtension: MutableSet<String> = hungPrefs.getStringSet("hungExtension", emptySet())!!.toMutableSet()
  private var imageCapture: ImageCapture? = null
  /** The selector of the current binding (maker extension or plain), to swap the photo use case. */
  private var boundSelector: CameraSelector? = null
  /** Output format the photo use case was bound with (JPEG, Ultra HDR or RAW). */
  private var photoFormat = ImageCapture.OUTPUT_FORMAT_JPEG
  private var videoCapture: VideoCapture<Recorder>? = null
  private var recording: Recording? = null
  private var config = CameraConfig()
  private var running = false
  private val location = LocationTracker(context)
  private val sounds = ShutterSound(context)
  private var targetRotation = android.view.Surface.ROTATION_0
  private var displayRotation = android.view.Surface.ROTATION_0
  /** What actually got bound after fallbacks (e.g. HDR dropped). */
  private var bound = BoundVideo()
  /** 0 = bound with everything asked for; higher = a fallback was needed (diagnostics). */
  private var bindAttempt = 0
  /** Slow motion as bound: speed factor (4 = 120 fps, 8 = 240 fps, 2 = 60 fps re-timed), and whether CameraX's high-speed session already slowed it. */
  private var lowLightBoostOn = false
  private var slowFactor = 1
  private var slowHighSpeed = false
  /** Per camera id: what slow motion it can do (0 = none). */
  private val slowCapability = mutableMapOf<String, Int>()

  private data class BoundVideo(
    val hdr: Boolean = false,
    val fps: Int = 30,
    val stabilized: Boolean = false,
    /** Photo fallback: plain JPEG if the phone refuses Ultra HDR / RAW. */
    val plainPhoto: Boolean = false,
    /** Video: last resort without the full-resolution photo stream (photos then come from video frames). */
    val noStill: Boolean = false,
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
  /** Long-press lock: auto exposure held (Camera2 AE lock) until unlocked or the camera re-binds. */
  private var aeLocked = false

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
    location.setActive(initial.saveLocation)
    sounds.enabled = initial.shutterSound
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
    location.setActive(false)
    recording?.stop()
    recording = null
    provider?.unbindAll()
    camera = null
    appliedRequestKey = null
  }

  fun release() {
    stop()
    sounds.release()
    io.shutdown()
  }

  fun update(next: CameraConfig) {
    val old = config
    config = next
    if (running) location.setActive(next.saveLocation)
    sounds.enabled = next.shutterSound
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
    lowLightBoostOn = false
    aeLocked = false // a new camera/mode starts unlocked (the app resets its lock badge too)

    // Fallback chain: if the phone refuses a combination (HDR + 60 fps + stabilization
    // on a budget phone, say), drop the most demanding option and try again.
    val attempts = if (config.isVideo) {
      listOf(
        BoundVideo(config.hdrVideo, config.fps, config.stabilization != "off"),
        BoundVideo(false, config.fps, config.stabilization != "off"),
        BoundVideo(false, 30, config.stabilization != "off"),
        BoundVideo(false, 30, false),
        BoundVideo(false, 30, false, noStill = true),
      ).distinct()
    } else {
      listOf(BoundVideo(), BoundVideo(plainPhoto = true))
    }
    var lastError: Exception? = null
    val baseSelector = cam.info.cameraSelector
    val ext = extensions
    nightExtension = config.isNight && ext != null && cam.id !in smallNightExtension && cam.id !in hungExtension &&
      runCatching { ext.isExtensionAvailable(baseSelector, ExtensionMode.NIGHT) }.getOrDefault(false)
    // Quality Lab: one of the maker's modes in Photo mode, when the phone has it.
    val labMode = DeviceProfile.EXTENSION_MODES.firstOrNull { it.first == config.extension }?.second
      ?.takeIf { config.mode == "photo" && ext != null && cam.id !in hungExtension && runCatching { ext.isExtensionAvailable(baseSelector, it) }.getOrDefault(false) }
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
    slowFactor = 1
    slowHighSpeed = false
    if (config.isSlowMo && bindHighSpeed(p, o, cam, selector)) return
    val tries = if (config.isSlowMo) listOf(BoundVideo(false, 60, false), BoundVideo(false, 30, false)) else attempts
    for ((attemptIndex, attempt) in tries.withIndex()) {
      try {
        p.unbindAll()
        val group = buildUseCases(cam, attempt)
        camera = p.bindToLifecycle(o, selector, group)
        boundSelector = selector
        bound = attempt
        bindAttempt = attemptIndex
        // Slow motion without high-speed video: 60 fps, re-timed to half speed after recording.
        if (config.isSlowMo) slowFactor = if (attempt.fps == 60 && videoFrameRate(cam, 60) != null) 2 else 1
        Log.i(TAG, "bound $attempt photo ${imageCapture?.resolutionInfo?.resolution} preview ${this.preview?.resolutionInfo?.resolution}")
        // "Never below the original": a maker Night mode that saves far smaller photos than the
        // camera can (Pixel 8a: 5 of 16 MP) loses to our own full-resolution Night merge.
        val photo = imageCapture?.resolutionInfo?.resolution
        val max = cam.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)?.getOutputSizes(ImageFormat.JPEG)?.maxByOrNull { it.width.toLong() * it.height }
        if (nightExtension && !makerNightBigEnough(photo?.width ?: 0, photo?.height ?: 0, max?.width ?: 0, max?.height ?: 0)) {
          Log.i(TAG, "maker Night saves $photo of $max: using Lens Night on camera ${cam.id}")
          smallNightExtension += cam.id
          return bind()
        }
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

  /**
   * Real slow motion where the phone maker exposes high-speed video to apps
   * (CameraX HighSpeedVideoSessionConfig): 120/240 fps, saved as a 30 fps file
   * that already plays slowed. Preview + video only (no photos in this mode).
   */
  private fun bindHighSpeed(p: ProcessCameraProvider, o: LifecycleOwner, cam: CameraFacts, selector: CameraSelector): Boolean {
    return try {
      val caps = Recorder.getHighSpeedVideoCapabilities(cam.info) ?: return false
      val qualities = caps.getSupportedQualities(DynamicRange.SDR)
      val quality = listOf(Quality.FHD, Quality.HD).firstOrNull { it in qualities } ?: qualities.firstOrNull() ?: return false
      val recorder = Recorder.Builder().setQualitySelector(QualitySelector.from(quality)).build()
      val video = VideoCapture.Builder(recorder).setTargetRotation(targetRotation).build()
      val preview = Preview.Builder().setTargetRotation(displayRotation).build()
      previewSurface?.let { preview.surfaceProvider = it }
      // Prefer 240 fps (8×), else the fastest offered; fixed ranges only.
      val ranges = cam.info.getSupportedFrameRateRanges(HighSpeedVideoSessionConfig(video, preview))
        .filter { it.lower == it.upper && it.upper >= 120 }
      val range = ranges.firstOrNull { it.upper == 240 } ?: ranges.maxByOrNull { it.upper } ?: return false
      p.unbindAll()
      camera = p.bindToLifecycle(o, selector, HighSpeedVideoSessionConfig(video, preview, range, true))
      this.preview = preview
      videoCapture = video
      imageCapture = null
      slowFactor = range.upper / 30
      slowHighSpeed = true
      Log.i(TAG, "bound high-speed slow motion $quality at ${range.upper} fps")
      applyLive()
      onReady?.invoke(capabilities())
      true
    } catch (e: Exception) {
      Log.w(TAG, "high-speed slow motion unavailable, using 60 fps", e)
      false
    }
  }

  /** What slow motion this camera can do: 8/4 (high-speed), 2 (60 fps re-timed) or 0. Cached per camera. */
  private fun slowMotionFactor(cam: CameraFacts): Int = slowCapability.getOrPut(cam.id) {
    val high = runCatching {
      val caps = Recorder.getHighSpeedVideoCapabilities(cam.info) ?: return@runCatching 0
      val q = caps.getSupportedQualities(DynamicRange.SDR).firstOrNull() ?: return@runCatching 0
      val video = VideoCapture.withOutput(Recorder.Builder().setQualitySelector(QualitySelector.from(q)).build())
      val best = cam.info.getSupportedFrameRateRanges(HighSpeedVideoSessionConfig(video, Preview.Builder().build()))
        .filter { it.lower == it.upper }.maxOfOrNull { it.upper } ?: 0
      if (best >= 240) 8 else if (best >= 120) 4 else 0
    }.getOrDefault(0)
    if (high > 0) high else if (videoFrameRate(cam, 60) != null) 2 else 0
  }

  private fun buildUseCases(cam: CameraFacts, video: BoundVideo): UseCaseGroup {
    // Video and time-lapse are 16:9 (time-lapse is made from these preview frames).
    val ratio = if (config.isVideo || config.isTimeLapse) AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY else AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY
    val previewBuilder = Preview.Builder()
      .setResolutionSelector(ResolutionSelector.Builder().setAspectRatioStrategy(ratio).build())
    // Night (our own merge): let auto exposure use slower frames for more light.
    // Photo modes: like the phone's own camera, let auto exposure drop to 15 fps
    // in dim light. A fixed 30 fps capped the shutter at 1/30 s, so indoors the
    // camera pushed ISO instead: dark, grainy (and smeared by noise reduction).
    val rate = when {
      config.isNight && !nightExtension -> nightFrameRate(cam)
      config.isVideo && config.autoLowLight && video.fps == 30 && !config.isSlowMo -> lowLightVideoRate(cam) ?: previewFrameRate(cam, 30)
      config.isVideo -> previewFrameRate(cam, video.fps)
      else -> photoFrameRate(cam) ?: previewFrameRate(cam, 30)
    }
    // Video: CameraX's target frame rate (it picks stream sizes that can run at
    // it). Photo modes: set the auto-exposure range on the camera directly
    // instead. A target frame rate makes CameraX choose only photo sizes that can
    // also stream at that rate: the Galaxy S8 then saved 1440×1080 (1.5 MP)
    // photos instead of its full 4032×3024.
    if (config.isVideo) {
      rate?.let { previewBuilder.setTargetFrameRate(it) }
    } else {
      rate?.let { Camera2Interop.Extender(previewBuilder).setCaptureRequestOption(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, it) }
    }
    // Per-frame metadata (ISO, shutter, focus, white balance) for the HUD.
    Camera2Interop.Extender(previewBuilder).setSessionCaptureCallback(captureCallback)
    // Time-lapse/hyperlapse: frames come from the preview, so stabilizing it steadies a hand-held one.
    if (config.isTimeLapse && runCatching { Preview.getPreviewCapabilities(cam.info).isStabilizationSupported }.getOrDefault(false)) {
      previewBuilder.setPreviewStabilizationEnabled(true)
    } else if (config.isVideo && video.stabilized && config.stabilization != "standard" &&
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
        // Front camera video as previewed (mirrored in the camera pipeline, no extra cost) or true-to-life.
        .setMirrorMode(if (config.mirrorFront) MirrorMode.MIRROR_MODE_ON_FRONT_ONLY else MirrorMode.MIRROR_MODE_OFF)
      if (video.fps != 30) videoFrameRate(cam, video.fps)?.let { builder.setTargetFrameRate(it) }
      if (video.stabilized && caps.isStabilizationSupported) builder.setVideoStabilizationEnabled(true)
      val videoUse = builder.build().also { group.addUseCase(it) }
      videoCapture = videoUse
      imageCapture = null
      // Photo while recording (checklist 3.7): a full-resolution JPEG stream next to the video,
      // only where the phone says preview + video + photo work together; else frames from the video.
      if (!config.isSlowMo && !video.noStill) {
        val still = ImageCapture.Builder()
          .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
          .setJpegQuality(95)
          .setResolutionSelector(
            ResolutionSelector.Builder()
              .setAspectRatioStrategy(AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY)
              .setResolutionStrategy(ResolutionStrategy.HIGHEST_AVAILABLE_STRATEGY)
              .build(),
          )
          .setTargetRotation(targetRotation)
          .build()
        val ok = runCatching { cam.info.isSessionConfigSupported(SessionConfig(listOf(preview, videoUse, still))) }.getOrDefault(false)
        if (ok) {
          photoFormat = ImageCapture.OUTPUT_FORMAT_JPEG
          imageCapture = still.also { group.addUseCase(it) }
        }
      }
    } else {
      photoFormat = if (video.plainPhoto) ImageCapture.OUTPUT_FORMAT_JPEG else choosePhotoFormat(cam)
      // Night bursts need quick successive shots; everything else, best quality.
      imageCapture = stillCapture((config.isNight && !nightExtension) || config.captureMode == "latency", photoFormat)
        .also { group.addUseCase(it) }
      videoCapture = null
    }
    return group.build()
  }

  /** The photo use case: full resolution, 4:3, JPEG 95; [latency] = the phone's quick capture path. */
  private fun stillCapture(latency: Boolean, format: Int): ImageCapture = ImageCapture.Builder()
    .setCaptureMode(if (latency) ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY else ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
    // 95 in every mode (CameraX would use 85 for quick captures, e.g. Night frames).
    .setJpegQuality(95)
    .setOutputFormat(format)
    .setResolutionSelector(
      ResolutionSelector.Builder()
        .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
        .setResolutionStrategy(ResolutionStrategy.HIGHEST_AVAILABLE_STRATEGY)
        .build(),
    )
    .setTargetRotation(targetRotation)
    .build()

  /**
   * Replaces only the photo use case (the viewfinder keeps running): smart burst
   * switches to the quick capture path and back. Main thread. Returns the new
   * capture, or null when the camera can't (the old one stays bound).
   */
  private fun swapStill(latency: Boolean, format: Int): ImageCapture? {
    val p = provider ?: return null
    val o = owner ?: return null
    val sel = boundSelector ?: return null
    val old = imageCapture ?: return null
    val next = stillCapture(latency, format)
    return try {
      p.unbind(old)
      p.bindToLifecycle(o, sel, next)
      imageCapture = next
      next
    } catch (e: Exception) {
      Log.w(TAG, "photo use case swap failed (latency=$latency)", e)
      runCatching { p.bindToLifecycle(o, sel, old) }
      imageCapture = old
      null
    }
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

  /** Normal video in the dark: 24–30 fps where offered (25 % more light per frame, motion still smooth). */
  private fun lowLightVideoRate(cam: CameraFacts): Range<Int>? {
    val ranges = runCatching { cam.info.supportedFrameRateRanges }.getOrNull().orEmpty()
    return ranges.firstOrNull { it.lower == 24 && it.upper == 30 }
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
    // Low-light boost (Android 15+ where the camera has it): Normal 30 fps SDR video only
    // (CameraX doesn't allow it with HDR or high frame rates).
    val wantBoost = config.isVideo && config.autoLowLight && !config.isSlowMo && !bound.hdr && bound.fps <= 30 &&
      config.exposureMode != "manual" && runCatching { cam.cameraInfo.isLowLightBoostSupported }.getOrDefault(false)
    if (wantBoost != lowLightBoostOn) {
      lowLightBoostOn = wantBoost
      runCatching { cam.cameraControl.enableLowLightBoostAsync(wantBoost) }
    }
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

    val astroExposure = astro
    if (astroExposure != null) {
      val (iso, ns) = astroExposure
      b.setCaptureRequestOption(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_OFF)
      b.setCaptureRequestOption(CaptureRequest.SENSOR_SENSITIVITY, iso)
      b.setCaptureRequestOption(CaptureRequest.SENSOR_EXPOSURE_TIME, ns)
      b.setCaptureRequestOption(CaptureRequest.SENSOR_FRAME_DURATION, maxOf(ns, 33_333_333L))
      parts += "astro:$iso:$ns"
    } else if (config.exposureMode == "manual" && f.canManualExposure) {
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

    // Face-aware exposure/focus (checklist 7.2): Normal camera, automatic exposure, where the
    // camera's own face detection offers it. Not with a long-press lock (that point wins).
    if (config.autoLowLight && config.exposureMode != "manual" && !aeLocked && f.facePriority && !config.isNight) {
      b.setCaptureRequestOption(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_USE_SCENE_MODE)
      b.setCaptureRequestOption(CaptureRequest.CONTROL_SCENE_MODE, CaptureRequest.CONTROL_SCENE_MODE_FACE_PRIORITY)
      parts += "faces"
    }

    if (aeLocked && config.exposureMode != "manual" && f.aeLockAvailable) {
      b.setCaptureRequestOption(CaptureRequest.CONTROL_AE_LOCK, true)
      parts += "aelock"
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
      // What the photo use case really got (e.g. "4032x3024"): catches silent downsizing.
      "photoSize" to imageCapture?.resolutionInfo?.resolution?.let { "${it.width}x${it.height}" },
      // Diagnostics: the largest JPEG this camera can give, what the preview got,
      // the hardware level and whether binding needed a fallback.
      "maxPhotoSize" to f.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
        ?.getOutputSizes(ImageFormat.JPEG)?.maxByOrNull { it.width.toLong() * it.height }?.let { "${it.width}x${it.height}" },
      "previewSize" to preview?.resolutionInfo?.resolution?.let { "${it.width}x${it.height}" },
      "level" to DeviceProfile.levelName(f.hardwareLevel),
      "bindAttempt" to bindAttempt,
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
      // Front cameras without a flash: the screen lights the face instead.
      "screenFlash" to (f.facingFront && !f.hasFlash),
      "torch" to f.hasFlash,
      "modes" to listOf("photo", "video", "night", "portrait") + if (slowMotionFactor(f) >= 2) listOf("slowmo") else emptyList(),
      // Slow-motion speed this camera gives (8×/4× high-speed, 2× from 60 fps), and what is bound now.
      "slowMotionFactor" to slowMotionFactor(f),
      "slowMotionBound" to if (config.isSlowMo) slowFactor else 0,
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
      // Low-light boost brightening the picture right now (Normal video, Android 15+).
      "lowLightBoost" to (lowLightBoostOn && cam.cameraInfo.lowLightBoostState.value == LowLightBoostState.ACTIVE),
    )
  }

  // ---------- Commands ----------

  /** Tap to focus at a point given as fractions of the preview buffer. */
  fun focusAtBuffer(x: Float, y: Float, lock: Boolean = false): Map<String, Any?> {
    val p = preview ?: return mapOf("af" to false, "ae" to false)
    return focusAt(SurfaceOrientedMeteringPointFactory(1f, 1f, p).createPoint(x, y), lock)
  }

  /**
   * Focus and expose at [point]. [lock] (long-press): no auto-cancel, and auto
   * exposure held once it has settled there. Returns what this camera could lock
   * (fixed-focus cameras: exposure only; some LEGACY cameras: focus only).
   */
  fun focusAt(point: MeteringPoint, lock: Boolean = false): Map<String, Any?> {
    val cam = camera ?: return mapOf("af" to false, "ae" to false)
    val f = facts
    val af = config.focusMode != "manual" && f?.hasAutofocus == true
    val flags = if (af) FocusMeteringAction.FLAG_AF or FocusMeteringAction.FLAG_AE else FocusMeteringAction.FLAG_AE
    val builder = FocusMeteringAction.Builder(point, flags)
    if (lock) builder.disableAutoCancel() else builder.setAutoCancelDuration(5, TimeUnit.SECONDS)
    // The camera facts to lock exposure with; null = no exposure lock (manual exposure or not supported).
    val lockFacts = if (lock && config.exposureMode != "manual" && f?.aeLockAvailable == true) f else null
    val aeLock = lockFacts != null
    if (aeLocked && !aeLock) {
      aeLocked = false
      f?.let { applyRequestOptions(cam, it) }
    }
    val future = runCatching { cam.cameraControl.startFocusAndMetering(builder.build()) }.getOrNull()
    if (lockFacts != null) {
      // Hold exposure once metering at the point has finished (else it would lock the old exposure).
      val apply = Runnable {
        if (camera === cam) {
          aeLocked = true
          applyRequestOptions(cam, lockFacts)
        }
      }
      if (future != null) future.addListener(apply, main) else apply.run()
    }
    return mapOf("af" to (lock && af), "ae" to aeLock)
  }

  /** Release a long-press lock: back to continuous auto focus and exposure. */
  fun unlockFocus() {
    val cam = camera ?: return
    aeLocked = false
    facts?.let { applyRequestOptions(cam, it) }
    runCatching { cam.cameraControl.cancelFocusAndMetering() }
  }

  /**
   * [screenFlash]: front cameras without a flash light the subject with the
   * screen instead (white screen at full brightness, like the phone's own
   * camera). "on" always, "auto" only in low light.
   */
  fun takePhoto(flash: String, screenFlash: ImageCapture.ScreenFlash? = null, done: (Result<Map<String, Any?>>) -> Unit) {
    val capture = imageCapture ?: return done(Result.failure(CameraException("The camera isn't ready for photos.")))
    val f = facts
    val useScreen = screenFlash != null && f != null && f.facingFront && !f.hasFlash &&
      (flash == "on" || (flash == "auto" && isDark()))
    if (useScreen) {
      capture.screenFlash = screenFlash
      capture.flashMode = ImageCapture.FLASH_MODE_SCREEN
    } else {
      capture.flashMode = when (flash) {
        "on" -> ImageCapture.FLASH_MODE_ON
        "auto" -> ImageCapture.FLASH_MODE_AUTO
        else -> ImageCapture.FLASH_MODE_OFF
      }
    }
    val raw = photoFormat == ImageCapture.OUTPUT_FORMAT_RAW
    val file = File(outputDir(), "lens-${UUID.randomUUID()}.${if (raw) "dng" else "jpg"}")
    // Watchdog: a capture that never answers (a maker extension hanging) must not freeze the
    // shutter. Whoever comes first wins: the photo, its error, or the timeout.
    val finished = java.util.concurrent.atomic.AtomicBoolean(false)
    val extension = boundExtension.takeIf { it != "none" }
    val camId = facts?.id
    val watchdog = Runnable {
      if (!finished.compareAndSet(false, true)) return@Runnable
      Log.w(TAG, "photo didn't finish in time (extension $extension, camera $camId)")
      if (extension != null && camId != null) {
        // Never again on this camera: rebind without the maker mode (Lens Night instead).
        hungExtension += camId
        hungPrefs.edit().putStringSet("hungExtension", hungExtension.toSet()).apply()
        bind()
      }
      done(Result.failure(CameraException(
        if (extension == "night") "Night took too long on this phone. Lens switched to its own Night: tap the shutter again."
        else "The photo took too long. Tap the shutter again.",
      )))
    }
    val handler = android.os.Handler(android.os.Looper.getMainLooper())
    handler.postDelayed(watchdog, if (extension != null) EXTENSION_TIMEOUT_MS else PHOTO_TIMEOUT_MS)
    capture.takePicture(
      outputOptions(file),
      io,
      object : ImageCapture.OnImageSavedCallback {
        // The click when the photo really starts, not on the press.
        override fun onCaptureStarted() = sounds.shutter()

        override fun onImageSaved(output: ImageCapture.OutputFileResults) {
          handler.removeCallbacks(watchdog)
          if (!finished.compareAndSet(false, true)) { file.delete(); return }
          val (w, h) = uprightSize(file)
          // Portrait: find the person and keep the mask inside the photo.
          val depth = !raw && config.mode == "portrait" && Portrait.addMask(file)
          done(Result.success(mapOf("uri" to "file://${file.absolutePath}", "width" to w, "height" to h, "raw" to raw, "depth" to depth, "depthKind" to if (depth) Portrait.lastKind else null, "autoAperture" to if (depth) PortraitStyle.autoAperture(Portrait.lastCoverage) else null)))
        }

        override fun onError(exception: ImageCaptureException) {
          handler.removeCallbacks(watchdog)
          if (!finished.compareAndSet(false, true)) return
          done(Result.failure(CameraException(exception.message ?: "Capture failed")))
        }
      },
    )
  }

  /** Low light, from what auto exposure is doing right now (same idea as the app's Night badge). */
  private fun isDark(): Boolean {
    val iso = lastIso ?: return false
    val exposureNs = lastExposureNs ?: 0L
    return iso >= 800 || (exposureNs >= 50_000_000L && iso >= 400)
  }

  /**
   * Night: with the maker's Night mode, one capture (the phone merges frames
   * itself). Otherwise a burst of [frames] shots merged by [NightMerge].
   */
  fun takeNightPhoto(frames: Int, hot: Boolean, done: (Result<Map<String, Any?>>) -> Unit) {
    if (nightExtension) return takePhoto("off", null, done)
    // A hot phone does less work: fewer frames.
    mergedShots((if (hot) minOf(frames, 3) else frames).coerceIn(1, 8), emptyMap(), done)
  }

  /**
   * Astro (checklist 9.6): what a long-exposure stack would use here, or null
   * where it can't help (no manual exposure, or the longest exposure the camera
   * allows is under half a second, so it would just be Night again). Each frame
   * gets about twice the light auto exposure was giving (dark skies are left
   * dark by auto exposure), ISO at most 800 (less noise per frame), up to 4 s;
   * frames add up to ~16 s.
   */
  fun astroPlan(): Map<String, Any?>? {
    val f = facts ?: return null
    if (!f.canManualExposure || nightExtension) return null
    val iso0 = lastIso ?: return null
    val ns0 = lastExposureNs ?: return null
    return planAstro(iso0, ns0, f.isoRange!!.lower, f.isoRange.upper, f.exposureRangeNs!!.upper)
  }

  /** Astro photo: [astroPlan]'s long exposures, aligned and stacked like Night. */
  fun takeAstroPhoto(done: (Result<Map<String, Any?>>) -> Unit) {
    val plan = astroPlan() ?: return done(Result.failure(CameraException("Astro isn't possible on this camera.")))
    val cam = camera ?: return done(Result.failure(CameraException("The camera isn't ready for photos.")))
    val f = facts ?: return done(Result.failure(CameraException("The camera isn't ready for photos.")))
    val ns = plan["exposureNs"] as Long
    astro = (plan["iso"] as Int) to ns
    applyRequestOptions(cam, f)
    fun restore() {
      astro = null
      camera?.let { c -> facts?.let { applyRequestOptions(c, it) } }
    }
    // Let a couple of long frames through so the new exposure is in effect before shooting.
    main.execute {
      android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
        mergedShots(plan["frames"] as Int, mapOf("astro" to plan["seconds"])) { result ->
          main.execute { restore() }
          done(result)
        }
      }, ns / 1_000_000 * 2 + 300)
    }
  }

  /** [count] photos in a row, aligned and merged ([NightMerge]); [extra] joins the result. */
  private fun mergedShots(count: Int, extra: Map<String, Any?>, done: (Result<Map<String, Any?>>) -> Unit) {
    val capture = imageCapture ?: return done(Result.failure(CameraException("The camera isn't ready for photos.")))
    capture.flashMode = ImageCapture.FLASH_MODE_OFF
    val dir = File(outputDir(), "night-${UUID.randomUUID()}").apply { mkdirs() }
    val shots = mutableListOf<File>()
    fun next() {
      val file = File(dir, "${shots.size}.jpg")
      capture.takePicture(
        outputOptions(file),
        io,
        object : ImageCapture.OnImageSavedCallback {
          // One click for the whole Night burst (first frame).
          override fun onCaptureStarted() {
            if (shots.isEmpty()) sounds.shutter()
          }

          override fun onImageSaved(output: ImageCapture.OutputFileResults) {
            shots += file
            // Next shot from the main thread, like the first.
            if (shots.size < count) return main.execute { next() }
            try {
              val result = File(outputDir(), "lens-night-${UUID.randomUUID()}.jpg")
              NightMerge.merge(shots, result)
              dir.deleteRecursively()
              val (w, h) = uprightSize(result)
              done(Result.success(mapOf("uri" to "file://${result.absolutePath}", "width" to w, "height" to h, "raw" to false, "depth" to false, "frames" to count) + extra))
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

  // ---------- Smart burst (checklist 7.3) ----------

  @Volatile private var burstStop = false
  private var bursting = false

  /**
   * Hold-the-shutter burst: photos back to back until [stopBurst] (or [max]), each
   * like a normal photo (mirror, location, sound). [onShot] gets the running count.
   * Then the best shot is picked off the main thread ([BurstPicker]).
   */
  fun startBurst(max: Int, onShot: (Int) -> Unit, done: (Result<Map<String, Any?>>) -> Unit) {
    if (imageCapture == null) return done(Result.failure(CameraException("The camera isn't ready for photos.")))
    if (bursting) return done(Result.failure(CameraException("Already taking a burst.")))
    if (photoFormat == ImageCapture.OUTPUT_FORMAT_RAW) return done(Result.failure(CameraException("Burst takes JPEG photos: turn RAW off.")))
    // The quick capture path: 2.5–3× faster than best quality on every phone tested
    // (Device Farm dev-68: 0.54–0.86 s vs 1.3–2.6 s per photo), so a 1.5 s hold
    // gives several shots instead of one. Photo mode only (video stills and Night
    // keep their own capture); best quality comes back when the burst ends.
    val quick = config.mode == "photo" && !nightExtension && config.captureMode != "latency" &&
      swapStill(latency = true, format = ImageCapture.OUTPUT_FORMAT_JPEG) != null
    val capture = imageCapture ?: return done(Result.failure(CameraException("The camera isn't ready for photos.")))
    capture.flashMode = ImageCapture.FLASH_MODE_OFF
    bursting = true
    burstStop = false
    val dir = File(outputDir(), "burst-${UUID.randomUUID()}").apply { mkdirs() }
    // Shots are requested as soon as the previous one is captured (not saved):
    // CameraX queues them, so saving overlaps the next capture.
    val saved = sortedMapOf<Int, Pair<File, Pair<Int, Int>>>()
    var requested = 0
    var inFlight = 0
    var finished = false
    fun finish() {
      if (finished || inFlight > 0) return
      finished = true
      bursting = false
      if (quick) swapStill(latency = false, format = photoFormat)
      val files = saved.values.map { it.first }
      val sizes = saved.values.map { it.second }
      if (files.isEmpty()) {
        dir.deleteRecursively()
        return done(Result.failure(CameraException("No photos were taken.")))
      }
      io.execute {
        val (best, shots) = runCatching { expo.modules.lenscamera.imaging.BurstPicker.pick(files) }.getOrElse { 0 to emptyList() }
        val frames = files.mapIndexed { i, f ->
          mapOf("uri" to "file://${f.absolutePath}", "width" to sizes[i].first, "height" to sizes[i].second,
            "sharpness" to shots.getOrNull(i)?.sharpness, "faces" to shots.getOrNull(i)?.faces)
        }
        main.execute { done(Result.success(mapOf("frames" to frames, "pick" to best, "quick" to quick))) }
      }
    }
    fun next() {
      if (burstStop || requested >= max) return finish()
      val index = requested++
      inFlight++
      val file = File(dir, "$index.jpg")
      capture.takePicture(
        outputOptions(file),
        io,
        object : ImageCapture.OnImageSavedCallback {
          override fun onCaptureStarted() {
            sounds.shutter()
            // At most two in flight: the one being saved and the next capture.
            main.execute { if (!finished && inFlight < 2) next() }
          }

          override fun onImageSaved(output: ImageCapture.OutputFileResults) {
            val size = uprightSize(file)
            main.execute {
              saved[index] = file to size
              inFlight--
              onShot(saved.size)
              if (burstStop || requested >= max) finish() else if (inFlight == 0) next()
            }
          }

          override fun onError(exception: ImageCaptureException) {
            Log.w(TAG, "burst shot failed", exception)
            main.execute {
              inFlight--
              burstStop = true
              finish()
            }
          }
        },
      )
    }
    next()
  }

  fun stopBurst() {
    burstStop = true
  }

  @SuppressLint("MissingPermission")
  fun startRecording(done: (Result<Map<String, Any?>>) -> Unit) {
    val capture = videoCapture ?: return done(Result.failure(CameraException("Switch to video mode to record.")))
    if (recording != null) return done(Result.failure(CameraException("Already recording.")))
    capture.targetRotation = targetRotation
    // <cache>/Camera: the same place upload-while-recording watches for the growing file.
    val dir = File(context.cacheDir, "Camera").apply { mkdirs() }
    val file = File(dir, "${UUID.randomUUID()}.mp4")
    val output = FileOutputOptions.Builder(file)
    if (config.saveLocation) location.current()?.let { output.setLocation(it) }
    val pending = capture.output.prepareRecording(context, output.build())
    // Before the mic starts (it opens 0.1–0.7 s later), so the beep isn't in the recording.
    sounds.recordStart()
    // Slow motion is silent (slowed sound is a drone), like the stock cameras.
    val withAudio = !config.isSlowMo && ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    if (withAudio) pending.withAudioEnabled()
    val retime = if (config.isSlowMo && !slowHighSpeed && slowFactor > 1) slowFactor else 1
    // Start delay (checklist 1.11): from the press until the encoder's first data.
    val requestedAt = SystemClock.elapsedRealtime()
    var startDelayMs: Long? = null
    // Sound health (checklist 3.8): tell the app when the mic gets blocked or fails, so a
    // silent video never goes unnoticed. External = a wired/USB mic is plugged in.
    val externalMic = withAudio && hasExternalMic()
    var lastAudio: String? = null
    recording = pending.start(main) { event ->
      if (withAudio) {
        val audio = when (event.recordingStats.audioStats.audioState) {
          AudioStats.AUDIO_STATE_SOURCE_SILENCED -> "silenced"
          AudioStats.AUDIO_STATE_ENCODER_ERROR, AudioStats.AUDIO_STATE_SOURCE_ERROR -> "error"
          else -> "ok"
        }
        if (audio != lastAudio) {
          lastAudio = audio
          onRecordingAudio?.invoke(audio, externalMic)
        }
      }
      if (startDelayMs == null && event.recordingStats.recordedDurationNanos > 0) {
        val delay = SystemClock.elapsedRealtime() - requestedAt
        startDelayMs = delay
        onRecordingStarted?.invoke(delay)
      }
      if (event is VideoRecordEvent.Finalize) {
        recording = null
        sounds.recordStop() // after the file is closed, so it isn't recorded
        val ok = !event.hasError() || event.error in OK_FINALIZE
        if (ok && file.exists() && file.length() > 0 && retime > 1) {
          // 60 fps → half speed: re-time off the main thread (copy, no re-encode).
          io.execute {
            val slow = File(file.parentFile, file.nameWithoutExtension + "-slow.mp4")
            val result = runCatching { SlowMotion.retime(file, slow, retime) }
            main.execute {
              result.fold({ duration ->
                file.delete()
                done(Result.success(mapOf("uri" to "file://${slow.absolutePath}", "duration" to duration, "startDelayMs" to startDelayMs, "slowFactor" to retime)))
              }, { e ->
                slow.delete()
                done(Result.failure(CameraException("Slow motion failed: ${e.message}")))
              })
            }
          }
        } else if (ok && file.exists() && file.length() > 0) {
          done(Result.success(mapOf("uri" to "file://${file.absolutePath}", "duration" to event.recordingStats.recordedDurationNanos / 1e9, "startDelayMs" to startDelayMs, "slowFactor" to if (config.isSlowMo) slowFactor else 1)))
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

  /** Pause/resume the current recording (one file; paused time isn't in it). False if not recording. */
  /** Video mode with a full-resolution photo stream bound next to the video (photo while recording). */
  val hasVideoStill get() = config.isVideo && imageCapture != null

  fun pauseRecording(): Boolean = recording?.let { it.pause(); true } ?: false

  fun resumeRecording(): Boolean = recording?.let { it.resume(); true } ?: false

  // ---------- Helpers ----------

  /** A wired or USB microphone is connected (Android records from it automatically). */
  private fun hasExternalMic(): Boolean {
    val audio = context.getSystemService(Context.AUDIO_SERVICE) as? android.media.AudioManager ?: return false
    return audio.getDevices(android.media.AudioManager.GET_DEVICES_INPUTS).any {
      it.type == android.media.AudioDeviceInfo.TYPE_WIRED_HEADSET || it.type == android.media.AudioDeviceInfo.TYPE_USB_DEVICE ||
        it.type == android.media.AudioDeviceInfo.TYPE_USB_HEADSET
    }
  }

  /** Where a photo goes; front-camera photos are flipped (EXIF only, no re-encode) when saving as previewed. */
  private fun outputOptions(file: File): ImageCapture.OutputFileOptions {
    val metadata = ImageCapture.Metadata()
    metadata.isReversedHorizontal = facts?.facingFront == true && config.mirrorFront
    if (config.saveLocation) location.current()?.let { metadata.location = it }
    return ImageCapture.OutputFileOptions.Builder(file).setMetadata(metadata).build()
  }

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
    /** A plain photo that hasn't finished after this is stuck (slowest seen: ~2 s with flash). */
    const val PHOTO_TIMEOUT_MS = 15_000L
    /** Maker extensions (Night merges frames itself, a few seconds normally). */
    const val EXTENSION_TIMEOUT_MS = 25_000L

    /**
     * Keep the maker's Night mode only if its photos are at least half the camera's
     * largest JPEG (unknown sizes keep it). Below that, Lens Night (full size) wins.
     */
    fun makerNightBigEnough(photoW: Int, photoH: Int, maxW: Int, maxH: Int): Boolean {
      if (photoW <= 0 || photoH <= 0 || maxW <= 0 || maxH <= 0) return true
      return photoW.toLong() * photoH >= maxW.toLong() * maxH / 2
    }

    /** [astroPlan]'s arithmetic (pure, unit-tested): auto exposure now → per-frame ISO/exposure and frame count. */
    fun planAstro(iso0: Int, ns0: Long, isoMin: Int, isoMax: Int, maxExposureNs: Long): Map<String, Any?>? {
      val longest = minOf(maxExposureNs, 4_000_000_000L)
      if (longest < 500_000_000L) return null
      val light = iso0.toDouble() * ns0 * 2
      var ns = longest
      val iso = (light / ns).roundToInt().coerceIn(isoMin, minOf(800, isoMax))
      // Little light needed: shorter frames at the lowest ISO instead of overexposing.
      if (iso.toDouble() * ns > light * 1.5) ns = (light / iso).toLong().coerceIn(500_000_000L, longest)
      val frames = (16_000_000_000L / ns).toInt().coerceIn(4, 12)
      return mapOf("iso" to iso, "exposureNs" to ns, "frames" to frames, "seconds" to frames * ns / 1e9)
    }

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
