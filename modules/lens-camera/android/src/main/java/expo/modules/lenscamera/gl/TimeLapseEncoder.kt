package expo.modules.lenscamera.gl

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.util.Log
import android.view.Surface
import java.io.File

/**
 * Time-lapse video writer: H.264 in an MP4, frames given one by one (from the
 * viewfinder's GPU frames via [inputSurface]) and stamped [FRAME_US] apart, so
 * the clip always plays at 30 fps however far apart the frames were taken.
 * No audio. Runs on the GL thread (draw → [frameDrawn] → drain).
 */
class TimeLapseEncoder(val width: Int, val height: Int, private val file: File) {
  private val codec: MediaCodec
  val inputSurface: Surface
  private var muxer: MediaMuxer? = null
  private var track = -1
  private val info = MediaCodec.BufferInfo()
  var frames = 0
    private set

  init {
    val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
      setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
      // Every frame is a different moment: high bitrate keeps detail (time-lapses have no motion redundancy).
      setInteger(MediaFormat.KEY_BIT_RATE, (width * height * 30 * 0.25).toInt().coerceIn(4_000_000, 40_000_000))
      setInteger(MediaFormat.KEY_FRAME_RATE, 30)
      setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
    }
    codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
    codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    inputSurface = codec.createInputSurface()
    codec.start()
  }

  /** Presentation time for the next frame (the caller sets it on the EGL surface before swapping). */
  fun nextPresentationNs(): Long = frames * FRAME_US * 1000L

  /** A frame was just swapped into [inputSurface]. */
  fun frameDrawn() {
    frames++
    drain(false)
  }

  /** Finish the file. Returns the clip length in seconds (0 if nothing was written; the file is removed then). */
  fun finish(): Double {
    runCatching {
      codec.signalEndOfInputStream()
      drain(true)
    }.onFailure { Log.w(TAG, "time-lapse finish failed", it) }
    runCatching { codec.stop() }
    runCatching { codec.release() }
    runCatching { inputSurface.release() }
    val m = muxer
    val ok = m != null && frames > 0
    runCatching { if (m != null) { m.stop(); m.release() } }
    muxer = null
    if (!ok) file.delete()
    return if (ok) frames * FRAME_US / 1e6 else 0.0
  }

  fun cancel() {
    runCatching { codec.stop() }
    runCatching { codec.release() }
    runCatching { inputSurface.release() }
    runCatching { muxer?.release() }
    muxer = null
    file.delete()
  }

  private fun drain(endOfStream: Boolean) {
    var waits = 0
    while (true) {
      val index = codec.dequeueOutputBuffer(info, if (endOfStream) 10_000L else 0L)
      when {
        index == MediaCodec.INFO_TRY_AGAIN_LATER -> if (!endOfStream || ++waits > 200) return // ≤ 2 s for the last frames
        index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
          val m = MediaMuxer(file.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
          track = m.addTrack(codec.outputFormat)
          m.start()
          muxer = m
        }
        index >= 0 -> {
          val buffer = codec.getOutputBuffer(index)
          val config = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
          if (buffer != null && info.size > 0 && !config && muxer != null) {
            buffer.position(info.offset)
            buffer.limit(info.offset + info.size)
            muxer!!.writeSampleData(track, buffer, info)
          }
          codec.releaseOutputBuffer(index, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
        }
        // Other status codes (e.g. output buffers changed on old phones): just ask again.
        else -> if (!endOfStream) return
      }
    }
  }

  companion object {
    private const val TAG = "LensTimeLapse"
    /** 30 fps output. */
    const val FRAME_US = 33_333L

    /**
     * Seconds between frames after [elapsedMs] of recording: the longer you
     * record, the further apart (so any length becomes a watchable clip).
     */
    fun intervalMs(elapsedMs: Long): Long = when {
      elapsedMs < 60_000 -> 500 // first minute: 15×
      elapsedMs < 5 * 60_000 -> 1_000 // up to 5 min: 30×
      elapsedMs < 20 * 60_000 -> 2_000 // up to 20 min: 60×
      else -> 4_000 // after that: 120×
    }
  }
}
