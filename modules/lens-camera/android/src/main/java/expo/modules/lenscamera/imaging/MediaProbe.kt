package expo.modules.lenscamera.imaging

import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import androidx.exifinterface.media.ExifInterface
import java.io.File

/**
 * What a saved file really contains, for the camera self-test (Test Lab
 * checks without a person looking at the result): photo metadata (mirror flag,
 * GPS, Ultra HDR gain map, motion photo) and a video's real frame count, frame
 * rate, length and sound.
 */
object MediaProbe {
  /** Photo: EXIF orientation (2/4/5/7 = mirrored), GPS, Ultra HDR gain map, motion photo XMP. */
  fun photo(file: File): Map<String, Any?> {
    val exif = runCatching { ExifInterface(file) }.getOrNull()
    val orientation = exif?.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_UNDEFINED) ?: 0
    val head = file.inputStream().use { s -> ByteArray(minOf(file.length(), HEAD_BYTES.toLong()).toInt()).also { s.read(it) } }
    val m = markers(head)
    return mapOf(
      "bytes" to file.length(),
      "orientation" to orientation,
      "mirrored" to (orientation in MIRRORED),
      "gps" to (exif?.latLong != null),
      "ultraHdr" to (m.gainMap && m.mpf),
      "motion" to m.motion,
      "makerNote" to (exif?.getAttribute(ExifInterface.TAG_MAKER_NOTE) != null),
    )
  }

  /** Video: duration (s), video frames and their real rate, size, rotation, audio track. */
  fun video(file: File): Map<String, Any?> {
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(file.absolutePath)
      var videoTrack = -1
      var audio = false
      var width = 0
      var height = 0
      var mime: String? = null
      var durationUs = 0L
      for (i in 0 until extractor.trackCount) {
        val f = extractor.getTrackFormat(i)
        val m = f.getString(MediaFormat.KEY_MIME) ?: continue
        if (f.containsKey(MediaFormat.KEY_DURATION)) durationUs = maxOf(durationUs, f.getLong(MediaFormat.KEY_DURATION))
        if (m.startsWith("video/") && videoTrack < 0) {
          videoTrack = i
          mime = m
          width = f.getInteger(MediaFormat.KEY_WIDTH)
          height = f.getInteger(MediaFormat.KEY_HEIGHT)
        } else if (m.startsWith("audio/")) {
          audio = true
        }
      }
      var frames = 0
      var firstUs = -1L
      var lastUs = -1L
      if (videoTrack >= 0) {
        extractor.selectTrack(videoTrack)
        while (true) {
          val t = extractor.sampleTime
          if (t < 0) break
          if (firstUs < 0 || t < firstUs) firstUs = t
          if (t > lastUs) lastUs = t
          frames++
          if (!extractor.advance()) break
        }
      }
      val span = lastUs - firstUs
      val rotation = runCatching {
        MediaMetadataRetriever().run {
          try {
            setDataSource(file.absolutePath)
            extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toInt()
          } finally {
            release()
          }
        }
      }.getOrNull()
      return mapOf(
        "bytes" to file.length(),
        "duration" to durationUs / 1e6,
        "frames" to frames,
        "fps" to if (frames > 1 && span > 0) Math.round((frames - 1) * 1e7 / span) / 10.0 else null,
        "width" to width,
        "height" to height,
        "rotation" to rotation,
        "codec" to mime,
        "audio" to audio,
      )
    } finally {
      extractor.release()
    }
  }

  data class Markers(val gainMap: Boolean, val mpf: Boolean, val motion: Boolean)

  /** Looks through the JPEG header segments for the Ultra HDR XMP + MPF and motion photo XMP. */
  internal fun markers(jpeg: ByteArray): Markers {
    var gainMap = false
    var mpf = false
    var motion = false
    if (jpeg.size < 4 || jpeg[0] != 0xFF.toByte() || jpeg[1] != 0xD8.toByte()) return Markers(false, false, false)
    var pos = 2
    while (pos + 4 <= jpeg.size && jpeg[pos] == 0xFF.toByte()) {
      val marker = jpeg[pos + 1].toInt() and 0xFF
      if (marker == 0xDA || marker == 0xD9) break
      val length = ((jpeg[pos + 2].toInt() and 0xFF) shl 8) or (jpeg[pos + 3].toInt() and 0xFF)
      val end = minOf(pos + 2 + length, jpeg.size)
      if (marker == 0xE1 || marker == 0xE2) {
        val text = String(jpeg, pos + 4, maxOf(0, end - pos - 4), Charsets.ISO_8859_1)
        if (marker == 0xE2 && text.startsWith("MPF\u0000")) mpf = true
        if (marker == 0xE1 && text.startsWith("http://ns.adobe.com/xap/1.0/")) {
          if (text.contains("hdrgm:Version") || text.contains("ns.adobe.com/hdr-gain-map/")) gainMap = true
          if (text.contains("MotionPhoto=\"1\"") || text.contains("<Camera:MotionPhoto>1") || text.contains("MicroVideo=\"1\"")) motion = true
        }
      }
      pos = pos + 2 + length
    }
    return Markers(gainMap, mpf, motion)
  }

  private const val HEAD_BYTES = 256 * 1024
  private val MIRRORED = setOf(
    ExifInterface.ORIENTATION_FLIP_HORIZONTAL,
    ExifInterface.ORIENTATION_FLIP_VERTICAL,
    ExifInterface.ORIENTATION_TRANSPOSE,
    ExifInterface.ORIENTATION_TRANSVERSE,
  )
}
