package expo.modules.lenscamera

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.File
import java.nio.ByteBuffer

/**
 * Slow motion for phones without high-speed video (checklist 3.5): a 60 fps
 * recording is re-timed so it plays at 30 fps, i.e. half speed. Only the
 * timestamps change: the video samples are copied as they are (no re-encode,
 * no quality loss, a second or two even for long clips). The sound is dropped
 * (slowed sound is a drone; the stock cameras do the same).
 */
object SlowMotion {
  /** Writes [output]: [input]'s video with every timestamp × [factor]. Returns the new duration in seconds. */
  fun retime(input: File, output: File, factor: Int): Double {
    val extractor = MediaExtractor()
    extractor.setDataSource(input.absolutePath)
    val muxer = MediaMuxer(output.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    try {
      val videoTrack = (0 until extractor.trackCount).firstOrNull {
        extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true
      } ?: throw IllegalStateException("No video track")
      val format = extractor.getTrackFormat(videoTrack)
      extractor.selectTrack(videoTrack)
      // Keep the recording's rotation (it is in the track/container metadata).
      if (format.containsKey(MediaFormat.KEY_ROTATION)) muxer.setOrientationHint(format.getInteger(MediaFormat.KEY_ROTATION))
      val out = muxer.addTrack(format)
      muxer.start()
      val size = if (format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) format.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE) else 4 * 1024 * 1024
      val buffer = ByteBuffer.allocate(maxOf(size, 1024 * 1024))
      val info = MediaCodec.BufferInfo()
      var first = -1L
      var last = 0L
      while (true) {
        info.size = extractor.readSampleData(buffer, 0)
        if (info.size < 0) break
        val t = extractor.sampleTime
        if (first < 0) first = t
        info.offset = 0
        info.presentationTimeUs = (t - first) * factor
        info.flags = if (extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0
        muxer.writeSampleData(out, buffer, info)
        last = info.presentationTimeUs
        extractor.advance()
      }
      return last / 1e6
    } finally {
      runCatching { muxer.stop() }
      runCatching { muxer.release() }
      extractor.release()
    }
  }
}
