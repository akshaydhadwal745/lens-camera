package expo.modules.lenscamera.gl

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.util.Log
import android.view.Surface
import java.io.File
import java.nio.ByteBuffer

/**
 * Motion photos (checklist 9.2): the viewfinder's frames are encoded all the
 * time (small H.264, hardware encoder) and only the last couple of seconds are
 * kept in memory. A shot asks for the moment around it: [BEFORE_US] before and
 * [AFTER_US] after; once the "after" frames are in, the clip is written as an
 * MP4 and handed back with where the still sits in it.
 *
 * Runs on the GL thread (GlPreview draws a frame → [frameDrawn]).
 */
class MotionClip(val width: Int, val height: Int) {
  private class Sample(val data: ByteArray, val ptsUs: Long, val key: Boolean)

  private class Request(val stillUs: Long, val file: File, val done: (Result<Pair<File, Long>>) -> Unit)

  private val codec: MediaCodec
  val inputSurface: Surface
  private var format: MediaFormat? = null
  private val samples = ArrayDeque<Sample>()
  private val requests = mutableListOf<Request>()
  private val info = MediaCodec.BufferInfo()

  /** Presentation time of the newest frame given to the encoder (µs, camera clock). */
  var lastFrameUs = -1L
    private set
  private var firstFrameUs = -1L
  private var lastSyncUs = -1L
  private var encoded = 0

  init {
    val f = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
      setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
      // ~1.5 MB for 3 s at 1280×960: like the stock cameras' motion photos.
      setInteger(MediaFormat.KEY_BIT_RATE, (width * height * 30 * 0.12).toInt().coerceIn(1_500_000, 6_000_000))
      setInteger(MediaFormat.KEY_FRAME_RATE, 30)
      // A key frame every second: the clip can start at most ~1 s before the wanted moment.
      setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
    }
    codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
    codec.configure(f, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    inputSurface = codec.createInputSurface()
    codec.start()
  }

  /** A frame stamped [ptsUs] was just swapped into [inputSurface]. */
  fun frameDrawn(ptsUs: Long) {
    if (firstFrameUs < 0) firstFrameUs = ptsUs
    lastFrameUs = ptsUs
    // Some encoders ignore the key-frame interval with surface input: ask for one every second.
    if (lastSyncUs < 0 || ptsUs - lastSyncUs >= 1_000_000L) {
      lastSyncUs = ptsUs
      runCatching { codec.setParameters(android.os.Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0) }) }
    }
    drain()
    trim()
    serve()
  }

  /**
   * The encoder can't keep up (a slow or software encoder drops frames from its
   * input surface): fewer than [MIN_FPS] + 4 frames a second came out after 3 s.
   */
  val tooSlow: Boolean
    get() {
      val seconds = (lastFrameUs - firstFrameUs) / 1e6
      return seconds >= 3 && encoded / seconds < MIN_FPS + 4
    }

  /** Clip around the newest frame (the shot's moment) into [file]; [done] gets (file, still time in the clip, µs). */
  fun capture(file: File, done: (Result<Pair<File, Long>>) -> Unit) {
    if (lastFrameUs < 0) return done(Result.failure(IllegalStateException("No motion frames yet.")))
    requests += Request(lastFrameUs, file, done)
  }

  fun release() {
    for (r in requests) r.done(Result.failure(IllegalStateException("Camera closed")))
    requests.clear()
    samples.clear()
    runCatching { codec.stop() }
    runCatching { codec.release() }
    runCatching { inputSurface.release() }
  }

  private fun drain() {
    while (true) {
      val index = codec.dequeueOutputBuffer(info, 0L)
      when {
        index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> format = codec.outputFormat
        index >= 0 -> {
          val buffer = codec.getOutputBuffer(index)
          val config = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
          if (buffer != null && info.size > 0 && !config) {
            buffer.position(info.offset)
            buffer.limit(info.offset + info.size)
            val data = ByteArray(info.size).also { buffer.get(it) }
            samples.addLast(Sample(data, info.presentationTimeUs, info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0))
            encoded++
          }
          codec.releaseOutputBuffer(index, false)
        }
        else -> return // try again later / old status codes
      }
    }
  }

  /** Keep from the last key frame that still covers [BEFORE_US] before the oldest moment anyone may want. */
  private fun trim() {
    val oldestWanted = (requests.minOfOrNull { it.stillUs } ?: lastFrameUs) - BEFORE_US
    while (samples.size > 1) {
      val nextKey = samples.drop(1).firstOrNull { it.key } ?: break
      if (nextKey.ptsUs <= oldestWanted) {
        while (samples.first() !== nextKey) samples.removeFirst()
      } else break
    }
    // Memory bound even if key frames never come: nothing older than MAX_KEEP_US.
    while (samples.isNotEmpty() && lastFrameUs - samples.first().ptsUs > MAX_KEEP_US) samples.removeFirst()
    while (samples.isNotEmpty() && !samples.first().key) samples.removeFirst()
  }

  private fun serve() {
    val ready = requests.filter { lastFrameUs >= it.stillUs + AFTER_US }
    for (r in ready) {
      requests.remove(r)
      r.done(runCatching { write(r) })
    }
  }

  private fun write(r: Request): Pair<File, Long> {
    val f = format ?: throw IllegalStateException("Encoder not ready")
    // Start at the last key frame at or before (still − BEFORE), else the oldest key frame we have.
    val keys = samples.filter { it.key }
    val start = keys.lastOrNull { it.ptsUs <= r.stillUs - BEFORE_US } ?: keys.firstOrNull()
      ?: throw IllegalStateException("No key frame yet")
    val clip = samples.filter { it.ptsUs >= start.ptsUs && it.ptsUs <= r.stillUs + AFTER_US }
    // Choppy (encoder too slow) or starting long before the shot: no motion rather than a bad one.
    val spanS = (clip.last().ptsUs - clip.first().ptsUs) / 1e6
    if (clip.size < 2 || spanS < 1.0 || clip.size / spanS < MIN_FPS || r.stillUs - start.ptsUs > BEFORE_US + 1_200_000L) {
      throw IllegalStateException("Motion clip not good enough (${clip.size} frames in ${"%.1f".format(spanS)} s)")
    }
    val muxer = MediaMuxer(r.file.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    try {
      val track = muxer.addTrack(f)
      muxer.start()
      val out = MediaCodec.BufferInfo()
      for (s in clip) {
        out.set(0, s.data.size, s.ptsUs - start.ptsUs, if (s.key) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
        muxer.writeSampleData(track, ByteBuffer.wrap(s.data), out)
      }
      muxer.stop()
    } finally {
      runCatching { muxer.release() }
    }
    Log.i(TAG, "motion clip ${clip.size} frames, still at ${(r.stillUs - start.ptsUs) / 1000} ms, ${r.file.length() / 1024} KB")
    return r.file to (r.stillUs - start.ptsUs)
  }

  companion object {
    private const val TAG = "LensMotion"
    const val BEFORE_US = 1_500_000L
    const val AFTER_US = 1_500_000L
    private const val MAX_KEEP_US = 5_000_000L
    /** Below this a clip looks like a slideshow: the photo is saved without motion. */
    const val MIN_FPS = 8
  }
}
