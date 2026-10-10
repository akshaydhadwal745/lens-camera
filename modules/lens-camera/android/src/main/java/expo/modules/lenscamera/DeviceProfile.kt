package expo.modules.lenscamera

import android.annotation.SuppressLint
import android.app.ActivityManager
import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CameraMetadata
import android.graphics.ImageFormat
import android.hardware.camera2.CameraExtensionCharacteristics
import android.os.Build
import android.util.Range
import android.util.SizeF
import androidx.annotation.OptIn
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.CameraInfo
import androidx.camera.core.CameraSelector
import androidx.camera.core.DynamicRange
import androidx.camera.extensions.ExtensionMode
import androidx.camera.extensions.ExtensionsManager
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.Quality
import androidx.camera.video.Recorder
import kotlin.math.atan
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.tan

/**
 * What this phone's cameras can do, read from Camera2 characteristics.
 *
 * Android phones differ wildly: a 2017 budget phone may be "LEGACY" (auto only),
 * a flagship "LEVEL_3" with manual sensor control, RAW and several lenses behind
 * one logical camera. Every feature Lens offers is decided here, so the UI only
 * shows what the hardware really supports.
 */
@OptIn(ExperimentalCamera2Interop::class)
class CameraFacts(val info: CameraInfo, private val chars: (CameraCharacteristics.Key<*>) -> Any?) {
  val id: String = Camera2CameraInfo.from(info).cameraId

  @Suppress("UNCHECKED_CAST")
  fun <T> get(key: CameraCharacteristics.Key<T>): T? = chars(key) as T?

  val facingBack get() = info.lensFacing == CameraSelector.LENS_FACING_BACK
  val facingFront get() = info.lensFacing == CameraSelector.LENS_FACING_FRONT

  val hardwareLevel: Int = get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL)
    ?: CameraMetadata.INFO_SUPPORTED_HARDWARE_LEVEL_LEGACY
  val capabilities: Set<Int> = get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES)?.toSet() ?: emptySet()

  val manualSensor get() = CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_SENSOR in capabilities
  val manualPostProcessing get() = CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_POST_PROCESSING in capabilities
  val readSensorSettings get() = CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_READ_SENSOR_SETTINGS in capabilities
  val rawCapable get() = CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_RAW in capabilities
  val logicalMulti get() = Build.VERSION.SDK_INT >= 28 && CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_LOGICAL_MULTI_CAMERA in capabilities

  val isoRange: Range<Int>? = get(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE)
  val exposureRangeNs: Range<Long>? = get(CameraCharacteristics.SENSOR_INFO_EXPOSURE_TIME_RANGE)
  /** Closest focus in diopters; 0 = fixed focus. */
  val minFocusDistance: Float = get(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE) ?: 0f
  val awbModes: Set<Int> = get(CameraCharacteristics.CONTROL_AWB_AVAILABLE_MODES)?.toSet() ?: emptySet()
  val afModes: Set<Int> = get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES)?.toSet() ?: emptySet()

  val canManualExposure get() = manualSensor && isoRange != null && exposureRangeNs != null
  val canManualFocus get() = manualSensor && minFocusDistance > 0f
  val awbPresets: List<ColorTemperature.Preset>
    get() = ColorTemperature.Preset.values().filter { awbModeFor(it) in awbModes }
  /** Kelvin dial: real gains (manual post-processing) or snapped presets. */
  val canManualWhiteBalance get() = manualPostProcessing || awbPresets.size >= 3

  /** Horizontal-ish field of view (radians) from the shortest focal length and sensor size. */
  val fieldOfView: Double? = run {
    val focal = get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.minOrNull()
    val size: SizeF? = get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)
    if (focal == null || size == null || focal <= 0f) null
    else 2 * atan(hypot(size.width.toDouble(), size.height.toDouble()) / (2 * focal))
  }

  val megapixels: Double = run {
    val a = get(CameraCharacteristics.SENSOR_INFO_PIXEL_ARRAY_SIZE)
    if (a == null) 0.0 else a.width.toDouble() * a.height / 1e6
  }

  /** CONTROL_ZOOM_RATIO_RANGE (Android 11+): below 1 means ultra-wide via zoom. */
  val zoomRatioRange: Range<Float>? =
    if (Build.VERSION.SDK_INT >= 30) get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE) else null

  val hasFlash get() = info.hasFlashUnit()

  companion object {
    fun awbModeFor(p: ColorTemperature.Preset) = when (p) {
      ColorTemperature.Preset.INCANDESCENT -> CameraMetadata.CONTROL_AWB_MODE_INCANDESCENT
      ColorTemperature.Preset.WARM_FLUORESCENT -> CameraMetadata.CONTROL_AWB_MODE_WARM_FLUORESCENT
      ColorTemperature.Preset.FLUORESCENT -> CameraMetadata.CONTROL_AWB_MODE_FLUORESCENT
      ColorTemperature.Preset.DAYLIGHT -> CameraMetadata.CONTROL_AWB_MODE_DAYLIGHT
      ColorTemperature.Preset.CLOUDY_DAYLIGHT -> CameraMetadata.CONTROL_AWB_MODE_CLOUDY_DAYLIGHT
      ColorTemperature.Preset.SHADE -> CameraMetadata.CONTROL_AWB_MODE_SHADE
    }

    fun from(info: CameraInfo): CameraFacts {
      val c2 = Camera2CameraInfo.from(info)
      return CameraFacts(info) { key -> runCatching { c2.getCameraCharacteristic(key) }.getOrNull() }
    }
  }
}

/** A lens button: either a zoom ratio on the main (logical) camera or a separate camera. */
data class LensOption(
  val id: String,
  val factor: Double,
  /** Zoom ratio on the main camera (logical multi-camera), or null. */
  val zoomRatio: Float?,
  /** A separate camera to switch to, or null. */
  val camera: CameraFacts?,
)

@OptIn(ExperimentalCamera2Interop::class)
class DeviceProfile(private val context: Context, private val provider: ProcessCameraProvider) {
  private val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager

  val cameras: List<CameraFacts> = provider.availableCameraInfos.mapNotNull {
    runCatching { CameraFacts.from(it) }.getOrNull()
  }

  val mainBack: CameraFacts? = runCatching {
    CameraSelector.DEFAULT_BACK_CAMERA.filter(provider.availableCameraInfos).firstOrNull()
  }.getOrNull()?.let { info -> cameras.firstOrNull { it.info == info } } ?: cameras.firstOrNull { it.facingBack }

  val mainFront: CameraFacts? = runCatching {
    CameraSelector.DEFAULT_FRONT_CAMERA.filter(provider.availableCameraInfos).firstOrNull()
  }.getOrNull()?.let { info -> cameras.firstOrNull { it.info == info } } ?: cameras.firstOrNull { it.facingFront }

  /**
   * Back lenses (ultra-wide / wide / telephoto) with their zoom factor relative
   * to the main camera.
   *
   * Modern phones put all lenses behind one "logical" camera and switch between
   * them by zoom ratio (0.6× is the ultra-wide). Older multi-camera phones expose
   * each lens as its own camera instead. Both are handled.
   */
  val backLenses: List<LensOption> by lazy { computeBackLenses() }

  private fun computeBackLenses(): List<LensOption> {
    val main = mainBack ?: return emptyList()
    val mainFov = main.fieldOfView
    val out = mutableListOf(LensOption("wide", 1.0, 1f, null))

    // 1) Ultra-wide reachable through zoom ratio (Android 11+ logical cameras).
    val minRatio = main.zoomRatioRange?.lower ?: main.info.zoomState.value?.minZoomRatio ?: 1f
    if (minRatio < 0.95f) out += LensOption("ultraWide", round1(minRatio.toDouble()), minRatio, null)

    // 2) Telephoto behind the logical camera: physical lenses' focal lengths.
    if (main.logicalMulti && mainFov != null && Build.VERSION.SDK_INT >= 28) {
      val maxRatio = main.zoomRatioRange?.upper ?: main.info.zoomState.value?.maxZoomRatio ?: 1f
      val physical = runCatching { manager.getCameraCharacteristics(main.id).physicalCameraIds }.getOrNull().orEmpty()
      val teleFactor = physical.mapNotNull { pid -> physicalFactor(pid, mainFov) }
        .filter { it >= 1.6 && it <= maxRatio + 0.01 }
        .maxOrNull()
      if (teleFactor != null) out += LensOption("telephoto", round1(teleFactor), teleFactor.toFloat(), null)
    }

    // 3) Separately exposed back cameras (older multi-camera phones).
    if (mainFov != null) {
      val others = cameras.filter { it.facingBack && it.id != main.id && it.megapixels >= 4.0 }
      for (cam in others) {
        val fov = cam.fieldOfView ?: continue
        val factor = tan(mainFov / 2) / tan(fov / 2)
        when {
          factor < 0.85 && out.none { it.id == "ultraWide" } ->
            out += LensOption("ultraWide", round1(factor), null, cam)
          factor > 1.6 && out.none { it.id == "telephoto" } ->
            out += LensOption("telephoto", round1(factor), null, cam)
        }
      }
    }
    return out.sortedBy { it.factor }
  }

  private fun physicalFactor(physicalId: String, mainFov: Double): Double? = runCatching {
    val c = manager.getCameraCharacteristics(physicalId)
    val focal = c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.minOrNull() ?: return null
    val size = c.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE) ?: return null
    val fov = 2 * atan(hypot(size.width.toDouble(), size.height.toDouble()) / (2 * focal))
    tan(mainFov / 2) / tan(fov / 2)
  }.getOrNull()

  private fun round1(v: Double) = (v * 10).roundToInt() / 10.0

  // ---------- Report for the "Camera info" screen ----------

  /** [ext]: CameraX extensions (the phone maker's own processing), if loaded. */
  @SuppressLint("NewApi")
  fun report(ext: ExtensionsManager? = null): Map<String, Any?> {
    val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val mem = ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
    val back = mainBack
    return mapOf(
      "device" to mapOf(
        "manufacturer" to Build.MANUFACTURER,
        "model" to Build.MODEL,
        "android" to Build.VERSION.RELEASE,
        "api" to Build.VERSION.SDK_INT,
        "abis" to Build.SUPPORTED_ABIS.toList(),
        "ramGB" to (mem.totalMem / 1e9 * 10).roundToInt() / 10.0,
        "lowRam" to am.isLowRamDevice,
        "hardware" to Build.HARDWARE,
        "board" to Build.BOARD,
        "soc" to if (Build.VERSION.SDK_INT >= 31) "${Build.SOC_MANUFACTURER} ${Build.SOC_MODEL}" else null,
      ),
      "tier" to tierOf(back),
      "lenses" to backLenses.map { mapOf("id" to it.id, "factor" to it.factor, "via" to if (it.camera != null) "camera ${it.camera.id}" else "zoom") },
      "cameras" to cameras.map { describe(it, ext) },
    )
  }

  fun tierOf(c: CameraFacts?): String = when {
    c == null -> "none"
    c.canManualExposure && c.manualPostProcessing -> "pro"
    c.hardwareLevel == CameraMetadata.INFO_SUPPORTED_HARDWARE_LEVEL_LEGACY -> "basic"
    else -> "standard"
  }

  private fun describe(c: CameraFacts, ext: ExtensionsManager?): Map<String, Any?> {
    val video = runCatching { Recorder.getVideoCapabilities(c.info) }.getOrNull()
    return mapOf(
      // Quality R&D (docs/research/camera-quality.md): what each photo pipeline can use.
      "extensions" to ext?.let { e ->
        EXTENSION_MODES.filter { (_, mode) -> runCatching { e.isExtensionAvailable(c.info.cameraSelector, mode) }.getOrDefault(false) }.map { it.first }
      },
      "camera2Extensions" to camera2Extensions(c.id),
      "noiseReductionModes" to c.get(CameraCharacteristics.NOISE_REDUCTION_AVAILABLE_NOISE_REDUCTION_MODES)?.map { noiseReductionName(it) },
      "edgeModes" to c.get(CameraCharacteristics.EDGE_AVAILABLE_EDGE_MODES)?.map { edgeName(it) },
      "sensorOrientation" to c.get(CameraCharacteristics.SENSOR_ORIENTATION),
      "streams" to streams(c),
      "id" to c.id,
      "facing" to when {
        c.facingBack -> "back"
        c.facingFront -> "front"
        else -> "external"
      },
      "level" to levelName(c.hardwareLevel),
      "capabilities" to c.capabilities.map { capabilityName(it) }.sorted(),
      "megapixels" to (c.megapixels * 10).roundToInt() / 10.0,
      "fovDegrees" to c.fieldOfView?.let { Math.toDegrees(it).roundToInt() },
      "iso" to c.isoRange?.let { "${it.lower}–${it.upper}" },
      "shutter" to c.exposureRangeNs?.let { "${formatNs(it.lower)}–${formatNs(it.upper)}" },
      "minFocusCm" to if (c.minFocusDistance > 0) (100 / c.minFocusDistance).roundToInt() else null,
      "awbPresets" to c.awbPresets.map { it.name.lowercase() },
      "flash" to c.hasFlash,
      "ois" to (c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_OPTICAL_STABILIZATION)?.any { it == CameraMetadata.LENS_OPTICAL_STABILIZATION_MODE_ON } == true),
      "zoomRatio" to c.zoomRatioRange?.let { "${it.lower}–${it.upper}" },
      "fps" to runCatching { c.info.supportedFrameRateRanges.map { "${it.lower}-${it.upper}" }.sorted() }.getOrNull(),
      "videoQualities" to video?.let { v -> v.getSupportedQualities(DynamicRange.SDR).map { qualityName(it) } },
      "hdrVideo" to video?.supportedDynamicRanges?.filter { it != DynamicRange.SDR }?.map { it.toString() },
    )
  }

  /** Largest JPEG / YUV / RAW size and how fast it can be captured back to back. */
  private fun streams(c: CameraFacts): Map<String, Any?>? {
    val map = c.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP) ?: return null
    fun entry(format: Int): Map<String, Any?>? = runCatching {
      val size = map.getOutputSizes(format)?.maxByOrNull { it.width.toLong() * it.height } ?: return@runCatching null
      val frameNs = map.getOutputMinFrameDuration(format, size)
      val stallNs = map.getOutputStallDuration(format, size)
      mapOf(
        "size" to "${size.width}x${size.height}",
        "maxFps" to if (frameNs > 0) (1e9 / frameNs * 10).roundToInt() / 10.0 else null,
        "stallMs" to stallNs / 1_000_000,
      )
    }.getOrNull()
    return mapOf(
      "jpeg" to entry(ImageFormat.JPEG),
      "yuv" to entry(ImageFormat.YUV_420_888),
      "raw" to entry(ImageFormat.RAW_SENSOR),
    )
  }

  @SuppressLint("NewApi")
  private fun camera2Extensions(id: String): List<String>? {
    if (Build.VERSION.SDK_INT < 31) return null
    return runCatching {
      manager.getCameraExtensionCharacteristics(id).supportedExtensions.map {
        when (it) {
          CameraExtensionCharacteristics.EXTENSION_AUTOMATIC -> "auto"
          CameraExtensionCharacteristics.EXTENSION_BOKEH -> "bokeh"
          CameraExtensionCharacteristics.EXTENSION_FACE_RETOUCH -> "faceRetouch"
          CameraExtensionCharacteristics.EXTENSION_HDR -> "hdr"
          CameraExtensionCharacteristics.EXTENSION_NIGHT -> "night"
          else -> "ext$it"
        }
      }
    }.getOrNull()
  }

  private fun noiseReductionName(m: Int) = when (m) {
    CameraMetadata.NOISE_REDUCTION_MODE_OFF -> "off"
    CameraMetadata.NOISE_REDUCTION_MODE_FAST -> "fast"
    CameraMetadata.NOISE_REDUCTION_MODE_HIGH_QUALITY -> "highQuality"
    CameraMetadata.NOISE_REDUCTION_MODE_MINIMAL -> "minimal"
    CameraMetadata.NOISE_REDUCTION_MODE_ZERO_SHUTTER_LAG -> "zsl"
    else -> "mode$m"
  }

  private fun edgeName(m: Int) = when (m) {
    CameraMetadata.EDGE_MODE_OFF -> "off"
    CameraMetadata.EDGE_MODE_FAST -> "fast"
    CameraMetadata.EDGE_MODE_HIGH_QUALITY -> "highQuality"
    CameraMetadata.EDGE_MODE_ZERO_SHUTTER_LAG -> "zsl"
    else -> "mode$m"
  }

  private fun formatNs(ns: Long): String {
    val s = ns / 1e9
    return if (s >= 0.5) "%.1fs".format(s) else "1/${max(1, (1 / s).roundToInt())}"
  }

  private fun qualityName(q: Quality) = when (q) {
    Quality.UHD -> "4K"
    Quality.FHD -> "1080p"
    Quality.HD -> "720p"
    Quality.SD -> "480p"
    else -> q.toString()
  }

  companion object {
    /** CameraX extension modes, by the name the app and the lab use. */
    val EXTENSION_MODES = listOf(
      "auto" to ExtensionMode.AUTO,
      "hdr" to ExtensionMode.HDR,
      "night" to ExtensionMode.NIGHT,
      "bokeh" to ExtensionMode.BOKEH,
      "faceRetouch" to ExtensionMode.FACE_RETOUCH,
    )

    fun levelName(level: Int) = when (level) {
      CameraMetadata.INFO_SUPPORTED_HARDWARE_LEVEL_LEGACY -> "LEGACY"
      CameraMetadata.INFO_SUPPORTED_HARDWARE_LEVEL_LIMITED -> "LIMITED"
      CameraMetadata.INFO_SUPPORTED_HARDWARE_LEVEL_FULL -> "FULL"
      CameraMetadata.INFO_SUPPORTED_HARDWARE_LEVEL_3 -> "LEVEL_3"
      CameraMetadata.INFO_SUPPORTED_HARDWARE_LEVEL_EXTERNAL -> "EXTERNAL"
      else -> "UNKNOWN($level)"
    }

    fun capabilityName(cap: Int) = when (cap) {
      CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_BACKWARD_COMPATIBLE -> "BACKWARD_COMPATIBLE"
      CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_SENSOR -> "MANUAL_SENSOR"
      CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_POST_PROCESSING -> "MANUAL_POST_PROCESSING"
      CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_RAW -> "RAW"
      CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_PRIVATE_REPROCESSING -> "PRIVATE_REPROCESSING"
      CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_READ_SENSOR_SETTINGS -> "READ_SENSOR_SETTINGS"
      CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_BURST_CAPTURE -> "BURST_CAPTURE"
      CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_YUV_REPROCESSING -> "YUV_REPROCESSING"
      CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_DEPTH_OUTPUT -> "DEPTH_OUTPUT"
      CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_CONSTRAINED_HIGH_SPEED_VIDEO -> "HIGH_SPEED_VIDEO"
      11 -> "MOTION_TRACKING"
      12 -> "LOGICAL_MULTI_CAMERA"
      13 -> "MONOCHROME"
      14 -> "SECURE_IMAGE_DATA"
      15 -> "SYSTEM_CAMERA"
      16 -> "OFFLINE_PROCESSING"
      17 -> "ULTRA_HIGH_RESOLUTION_SENSOR"
      18 -> "REMOSAIC_REPROCESSING"
      19 -> "DYNAMIC_RANGE_TEN_BIT"
      20 -> "STREAM_USE_CASE"
      21 -> "COLOR_SPACE_PROFILES"
      else -> "CAP_$cap"
    }
  }
}
