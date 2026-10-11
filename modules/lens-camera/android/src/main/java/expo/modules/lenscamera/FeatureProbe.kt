package expo.modules.lenscamera

import android.hardware.camera2.CameraCharacteristics
import android.media.CamcorderProfile
import android.media.MediaCodecList
import android.media.MediaFormat
import androidx.camera.core.DynamicRange
import androidx.camera.core.ImageCapture
import androidx.camera.core.Preview
import androidx.camera.core.SessionConfig
import androidx.camera.video.HighSpeedVideoSessionConfig
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.VideoCapture

/**
 * What each planned camera feature can use on this phone, measured with the
 * phone's own answers (docs/research/camera-features.md, checklist item 1.1).
 * Nothing here is assumed from the model name. Every probe is isolated: one
 * that throws reports "error: …" and the others still run.
 *
 * Use cases are only built to ask CameraX questions; nothing is bound, so the
 * running camera isn't touched. Call on the main thread (CameraX use cases).
 */
object FeatureProbe {
  fun camera(c: CameraFacts): Map<String, Any?> = mapOf(
    "slowMotion" to probe { slowMotion(c) },
    "slowMotionCamera2" to probe { camera2HighSpeed(c) },
    "fps60" to probe { fps60(c) },
    "videoWithPhoto" to probe { videoWithPhoto(c) },
    "timeLapseProfiles" to probe { timeLapseProfiles(c) },
    "lowLightBoost" to probe { c.info.isLowLightBoostSupported },
    "videoStabilization" to probe { Recorder.getVideoCapabilities(c.info).isStabilizationSupported },
    "previewStabilization" to probe { Preview.getPreviewCapabilities(c.info).isStabilizationSupported },
    "zeroShutterLag" to probe { c.info.isZslSupported },
    "torchStrength" to probe { c.info.isTorchStrengthSupported },
  )

  /** Hardware video encoders: what time-lapse, slow motion and 4K/60 can be written with. */
  fun codecs(): Any? = probe {
    val encoders = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.filter { it.isEncoder }
    fun software(name: String) = name.startsWith("c2.android") || name.startsWith("OMX.google")
    fun best(mime: String): Map<String, Any?>? {
      val forMime = encoders.filter { e -> e.supportedTypes.any { it.equals(mime, ignoreCase = true) } }
      // Hardware first; a software encoder still counts (emulators, some budget phones), marked as such.
      val info = forMime.firstOrNull { !software(it.name) } ?: forMime.firstOrNull() ?: return null
      val caps = info.getCapabilitiesForType(mime).videoCapabilities ?: return null
      return mapOf(
        "name" to info.name,
        "hardware" to !software(info.name),
        "maxSize" to "${caps.supportedWidths.upper}x${caps.supportedHeights.upper}",
        "4k30" to caps.areSizeAndRateSupported(3840, 2160, 30.0),
        "4k60" to caps.areSizeAndRateSupported(3840, 2160, 60.0),
        "1080p60" to caps.areSizeAndRateSupported(1920, 1080, 60.0),
        "1080p120" to caps.areSizeAndRateSupported(1920, 1080, 120.0),
        "720p240" to caps.areSizeAndRateSupported(1280, 720, 240.0),
      )
    }
    mapOf("avc" to best(MediaFormat.MIMETYPE_VIDEO_AVC), "hevc" to best(MediaFormat.MIMETYPE_VIDEO_HEVC))
  }

  /** CameraX slow motion (CameraX 1.5+): qualities and the high frame rates each can run. */
  private fun slowMotion(c: CameraFacts): Map<String, Any?>? {
    val caps = Recorder.getHighSpeedVideoCapabilities(c.info) ?: return null
    val qualities = caps.getSupportedQualities(DynamicRange.SDR)
    if (qualities.isEmpty()) return null
    return qualities.associate { q ->
      val video = VideoCapture.withOutput(Recorder.Builder().setQualitySelector(QualitySelector.from(q)).build())
      val config = HighSpeedVideoSessionConfig(video, Preview.Builder().build())
      qualityName(q) to c.info.getSupportedFrameRateRanges(config).map { "${it.lower}-${it.upper}" }.sorted()
    }
  }

  /** The raw Camera2 view of high-speed video (sizes and fps), in case CameraX hides some. */
  private fun camera2HighSpeed(c: CameraFacts): Map<String, Any?>? {
    if (CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_CONSTRAINED_HIGH_SPEED_VIDEO !in c.capabilities) return null
    val map = c.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP) ?: return null
    return map.highSpeedVideoSizes.sortedByDescending { it.width * it.height }.take(4).associate { size ->
      "${size.width}x${size.height}" to map.getHighSpeedVideoFpsRangesFor(size).map { "${it.lower}-${it.upper}" }.distinct().sorted()
    }
  }

  /** Highest frame rate CameraX offers with preview + video, per video quality the camera has. */
  private fun fps60(c: CameraFacts): Map<String, Any?> {
    val supported = Recorder.getVideoCapabilities(c.info).getSupportedQualities(DynamicRange.SDR)
    return supported.associate { q ->
      val video = VideoCapture.withOutput(Recorder.Builder().setQualitySelector(QualitySelector.from(q)).build())
      val ranges = c.info.getSupportedFrameRateRanges(SessionConfig(listOf(Preview.Builder().build(), video)))
      qualityName(q) to (ranges.maxOfOrNull { it.upper } ?: 0)
    }
  }

  /** Can a full-resolution photo be taken while recording (preview + video + photo at once)? */
  private fun videoWithPhoto(c: CameraFacts): Map<String, Any?> {
    val supported = Recorder.getVideoCapabilities(c.info).getSupportedQualities(DynamicRange.SDR)
    return supported.associate { q ->
      val video = VideoCapture.withOutput(Recorder.Builder().setQualitySelector(QualitySelector.from(q)).build())
      val config = SessionConfig(listOf(Preview.Builder().build(), video, ImageCapture.Builder().build()))
      qualityName(q) to c.info.isSessionConfigSupported(config)
    }
  }

  /** The phone maker's time-lapse recording profiles (MediaRecorder path), by camera id. */
  private fun timeLapseProfiles(c: CameraFacts): List<String>? {
    val id = c.id.toIntOrNull() ?: return null
    return listOf(
      "1080p" to CamcorderProfile.QUALITY_TIME_LAPSE_1080P,
      "2160p" to CamcorderProfile.QUALITY_TIME_LAPSE_2160P,
      "720p" to CamcorderProfile.QUALITY_TIME_LAPSE_720P,
      "high" to CamcorderProfile.QUALITY_TIME_LAPSE_HIGH,
    ).filter { (_, q) -> CamcorderProfile.hasProfile(id, q) }.map { it.first }
  }

  private fun qualityName(q: Quality) = when (q) {
    Quality.UHD -> "4K"
    Quality.FHD -> "1080p"
    Quality.HD -> "720p"
    Quality.SD -> "480p"
    else -> q.toString()
  }

  private fun <T> probe(block: () -> T): Any? = try {
    block()
  } catch (e: Throwable) {
    "error: ${e.javaClass.simpleName}: ${e.message?.take(120)}"
  }
}
