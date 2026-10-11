package expo.modules.lenscamera.gl

import android.content.Context
import android.graphics.SurfaceTexture
import android.opengl.EGL14
import android.opengl.EGLSurface
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.Matrix
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.util.Size
import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView
import androidx.camera.core.Preview
import androidx.camera.core.SurfaceRequest
import expo.modules.lenscamera.AnalysisOptions
import expo.modules.lenscamera.LookStore
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executor
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * The viewfinder: camera frames drawn with OpenGL ES 2.0 onto a SurfaceView.
 *
 * One pass per frame applies the live look (one LUT lookup) and the monitoring
 * overlays (zebra, focus peaking, false colour). Four times a second a tiny
 * 96×72 copy is read back for the histogram. No extra camera stream is needed
 * for any of it, and the photo/video files are never touched (looks stay a
 * removable edit).
 *
 * Portrait: the frame is also drawn at ¼ size every frame (the blurred
 * background is read from that, so the blur costs a few texture reads), and a
 * ~320 px copy goes to [LivePortrait] a few times a second for the person mask.
 *
 * Night (Lens's own merge): the viewfinder shows what the photo will look like:
 * the same shadow lift as [expo.modules.lenscamera.NightMerge] (measured on the
 * 96×72 copy), and frames averaged over time (less grain, like the burst
 * average) except where something moved.
 */
class GlPreview(private val context: Context) : Preview.SurfaceProvider, SurfaceHolder.Callback {
  val view = SurfaceView(context)

  /** Histogram results: 64 bins normalised to the peak, plus clip fractions. */
  var onHistogram: ((DoubleArray, Double, Double) -> Unit)? = null
  /** GL couldn't start on this phone; the owner falls back to a plain preview. */
  var onFailed: ((String) -> Unit)? = null
  /** How the camera hands frames to the preview (diagnostics: which rotation path ran). */
  var onTransform: ((Map<String, Any?>) -> Unit)? = null
  /** Smart look suggestion changed (a look id, or null). */
  var onSceneLook: ((String?) -> Unit)? = null
  /** First frame drawn after a new camera stream (hides the black gap on switches). */
  var onFirstFrame: (() -> Unit)? = null

  private val thread = HandlerThread("LensPreview").apply { start() }
  private val gl = Handler(thread.looper)
  private val glExecutor = Executor { gl.post(it) }
  private val mainHandler = Handler(Looper.getMainLooper())

  // GL thread state.
  private var egl: EglCore? = null
  private var pbuffer: EGLSurface = EGL14.EGL_NO_SURFACE
  private var window: EGLSurface = EGL14.EGL_NO_SURFACE
  private var program = 0
  private var analysisProgram = 0
  private var oesTexture = 0
  private var surfaceTexture: SurfaceTexture? = null
  private var inputSurface: Surface? = null
  private var bufferSize = Size(1, 1)
  // From CameraX's TransformationInfo (see computeUvMatrix).
  @Volatile private var rotationDegrees = 0
  @Volatile private var targetRotation = Surface.ROTATION_0
  @Volatile private var hasCameraTransform = false
  @Volatile private var isMirroring = false
  private var viewWidth = 1
  private var viewHeight = 1
  /**
   * Where the camera picture goes in the view (fractions x, y, w, h; origin top-left):
   * the saved photo/video frame, so the viewfinder shows exactly what is kept (WYSIWYG,
   * checklist 9 aspect ratios). Outside it is black. Default: the whole view.
   */
  @Volatile var frame = floatArrayOf(0f, 0f, 1f, 1f)
  private val frameW get() = max(1, (frame[2] * viewWidth).roundToInt())
  private val frameH get() = max(1, (frame[3] * viewHeight).roundToInt())
  private val frameX get() = (frame[0] * viewWidth).roundToInt()
  /** GL viewport y (origin bottom-left). */
  private val frameYgl get() = viewHeight - (frame[1] * viewHeight).roundToInt() - frameH
  private val stMatrix = FloatArray(16)
  private val uvMatrix = FloatArray(16)
  /** stMatrix · uvMatrix of the last frame: view uv -> buffer, for tap-to-focus. */
  @Volatile private var focusMatrix = FloatArray(16).also { Matrix.setIdentityM(it, 0) }
  private var lutTexture = 0
  private var lutId: String? = null
  private var analysisFbo = 0
  private var analysisTexture = 0
  private var lastAnalysis = 0L
  private val analysisPixels = ByteBuffer.allocateDirect(AW * AH * 4).order(ByteOrder.nativeOrder())
  private var firstFrame = true
  private var failed = false

  // Portrait in the viewfinder (GL thread, except the LivePortrait callback).
  private var copyProgram = 0
  private var blurFbo = 0
  private var blurTexture = 0
  private var blurW = 0
  private var blurH = 0
  private var segFbo = 0
  private var segTexture = 0
  private var segW = 0
  private var segH = 0
  private var segPixels: ByteBuffer? = null
  private var maskTexture = 0
  private var hasSubject = false
  private var lastSeg = 0L
  private var portraitWasOn = false
  // Night preview: running average of frames (ping-pong) and the live shadow lift.
  private var accumProgram = 0
  private val accumTex = IntArray(2)
  private val accumFbo = IntArray(2)
  private var accumW = 0
  private var accumH = 0
  private var accumIndex = 0
  private var accumValid = false
  private var nightLift = 1f
  private var nightLiftTarget = 1f
  // Time-lapse (GL thread): encoder fed with viewfinder frames at growing intervals.
  @Volatile private var recordable = false
  /** This phone's GPU can feed a video encoder (time-lapse). Known once GL has started. */
  val canTimeLapse get() = recordable && !failed
  private var timeLapse: TimeLapseEncoder? = null
  private var timeLapseSurface: EGLSurface = EGL14.EGL_NO_SURFACE
  private var timeLapseStart = 0L
  private var timeLapseLast = 0L
  private var timeLapseDone: ((Result<Map<String, Any?>>) -> Unit)? = null
  private var timeLapseFile: java.io.File? = null
  private val timeLapseUv = FloatArray(16)
  // Motion photos (checklist 9.2): the last seconds of the viewfinder, encoded, while on.
  /** Keep a motion clip ready for photos (photo mode with Motion on). */
  @Volatile var motionPhoto = false
  private var motion: MotionClip? = null
  private var motionSurface: EGLSurface = EGL14.EGL_NO_SURFACE
  private val motionUv = FloatArray(16)
  private var lastMotionNs = 0L
  // Deflicker: frame brightness vs its running average (from the 96×72 analysis).
  private var meanLuma = -1f
  private var smoothLuma = -1f
  // Smart look suggestion (checklist 5.3): scene labels a few times a minute.
  private val scene = SceneLabeler().also { s ->
    s.onSuggestion = { look -> mainHandler.post { onSceneLook?.invoke(look) } }
  }
  private var lastScene = 0L
  private var sceneWasOn = false
  private val livePortrait = LivePortrait().also { live ->
    live.onMask = { mask, w, h, subject -> gl.post { uploadMask(mask, w, h, subject) } }
  }

  // Set from the main thread, read on the GL thread.
  @Volatile var look: String? = null
  @Volatile var lookIntensity = 1.0
  @Volatile var analysis = AnalysisOptions()
  @Volatile var paused = false
  /** Portrait background blur as a fraction of the frame's long side (0 = off). See [LivePortrait.blurFraction]. */
  @Volatile var portraitBlur = 0f
  /** Normal camera: derive the blur from how much of the frame the person fills (overrides [portraitBlur] when > 0 people). */
  @Volatile var portraitAuto = false
  /** Portrait style (see [expo.modules.lenscamera.imaging.PortraitStyle]): 0 natural … 3 stage. */
  @Volatile var portraitStyle = 0f
  /** Night photo coming (Night mode or auto Night with Lens's own merge): preview it brightened and averaged. */
  @Volatile var nightPreview = false
  /** Suggest a look for the scene (Normal camera, no look chosen, not Portrait/time-lapse). */
  @Volatile var sceneSuggest = false
  /** Frames shown so far (preview frame rate: self-test, checklist 1.1). */
  @Volatile var framesDrawn = 0L
    private set

  init {
    view.holder.addCallback(this)
    gl.post { setUpGl() }
  }

  private fun setUpGl() {
    try {
      // Recordable, so time-lapse can draw into a video encoder's surface; plain config if a phone refuses.
      val core = runCatching { EglCore(recordable = true) }.getOrNull()?.also { recordable = true } ?: EglCore()
      egl = core
      pbuffer = core.pbuffer()
      core.makeCurrent(pbuffer)
      program = GlUtil.program(VERTEX, FRAGMENT)
      analysisProgram = GlUtil.program(VERTEX, ANALYSIS_FRAGMENT)
      copyProgram = GlUtil.program(VERTEX, COPY_FRAGMENT)
      accumProgram = GlUtil.program(VERTEX, ACCUM_FRAGMENT)
      val (tex, fbo) = GlUtil.framebuffer(AW, AH)
      analysisTexture = tex
      analysisFbo = fbo
    } catch (e: Exception) {
      fail("OpenGL setup failed: ${e.message}")
    }
  }

  private fun fail(message: String) {
    if (failed) return
    failed = true
    Log.w(TAG, message)
    mainHandler.post { onFailed?.invoke(message) }
  }

  // ---------- Camera input (CameraX Preview surface) ----------

  override fun onSurfaceRequested(request: SurfaceRequest) {
    Log.i(TAG, "surface requested ${request.resolution}")
    gl.post {
      val core = egl
      if (core == null || failed) {
        request.willNotProvideSurface()
        return@post
      }
      core.makeCurrent(if (window != EGL14.EGL_NO_SURFACE) window else pbuffer)
      releaseInput()
      val t = IntArray(1)
      GLES20.glGenTextures(1, t, 0)
      oesTexture = t[0]
      GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, oesTexture)
      GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
      GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
      GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
      GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
      bufferSize = request.resolution
      // New camera stream (switched camera/mode): don't blend in the old camera's
      // night frames or use its person mask.
      accumValid = false
      hasSubject = false
      livePortrait.reset()
      val st = SurfaceTexture(oesTexture).apply {
        setDefaultBufferSize(request.resolution.width, request.resolution.height)
        setOnFrameAvailableListener({ draw() }, gl)
      }
      surfaceTexture = st
      val surface = Surface(st)
      inputSurface = surface
      firstFrame = true
      request.setTransformationInfoListener(glExecutor) { info ->
        rotationDegrees = info.rotationDegrees
        targetRotation = info.targetRotation
        hasCameraTransform = info.hasCameraTransform()
        isMirroring = info.isMirroring
        Log.i(TAG, "transform rotation ${info.rotationDegrees} target ${info.targetRotation} cameraTransform ${info.hasCameraTransform()} mirroring ${info.isMirroring}")
        val details = mapOf<String, Any?>(
          "rotationDegrees" to info.rotationDegrees,
          "targetRotation" to info.targetRotation,
          "cameraTransform" to info.hasCameraTransform(),
          "mirroring" to info.isMirroring,
          "buffer" to "${request.resolution.width}x${request.resolution.height}",
        )
        mainHandler.post { onTransform?.invoke(details) }
      }
      request.provideSurface(surface, glExecutor) {
        // CameraX is done with this surface (camera switched or stopped).
        if (inputSurface === surface) releaseInput() else {
          surface.release()
          st.release()
        }
      }
    }
  }

  private fun releaseInput() {
    surfaceTexture?.setOnFrameAvailableListener(null)
    surfaceTexture?.release()
    inputSurface?.release()
    surfaceTexture = null
    inputSurface = null
    if (oesTexture != 0) GLES20.glDeleteTextures(1, intArrayOf(oesTexture), 0)
    oesTexture = 0
  }

  // ---------- Screen output ----------

  override fun surfaceCreated(holder: SurfaceHolder) {
    Log.i(TAG, "screen surface created")
  }

  override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
    Log.i(TAG, "screen surface ${width}x$height")
    val surface = holder.surface
    gl.post {
      val core = egl ?: return@post
      viewWidth = max(1, width)
      viewHeight = max(1, height)
      if (window == EGL14.EGL_NO_SURFACE) {
        try {
          window = core.windowSurface(surface)
        } catch (e: Exception) {
          fail("Preview surface failed: ${e.message}")
        }
      }
    }
  }

  override fun surfaceDestroyed(holder: SurfaceHolder) {
    // Must finish before returning: the surface goes away right after.
    val done = java.util.concurrent.CountDownLatch(1)
    gl.post {
      egl?.let { core ->
        if (window != EGL14.EGL_NO_SURFACE) {
          core.makeCurrent(pbuffer)
          core.releaseSurface(window)
          window = EGL14.EGL_NO_SURFACE
        }
      }
      done.countDown()
    }
    done.await(500, java.util.concurrent.TimeUnit.MILLISECONDS)
  }

  // ---------- Drawing ----------

  private fun draw() {
    val core = egl ?: return
    val st = surfaceTexture ?: return
    try {
      core.makeCurrent(if (window != EGL14.EGL_NO_SURFACE) window else pbuffer)
      st.updateTexImage()
      if (window == EGL14.EGL_NO_SURFACE || paused) return
      st.getTransformMatrix(stMatrix)
      computeUvMatrix()

      val now = SystemClock.uptimeMillis()
      val a = analysis
      val night = nightPreview
      val lapse = timeLapse != null
      if (((a.histogram && onHistogram != null) || night || lapse) && now - lastAnalysis >= 250) {
        lastAnalysis = now
        runAnalysis(a.histogram && onHistogram != null, night)
      }
      val accumulated = if (night) accumulate() else {
        accumValid = false
        nightLift = 1f
        nightLiftTarget = 1f
        0
      }
      if (night) nightLift += (nightLiftTarget - nightLift) * 0.15f
      val blur = portraitBlur
      val portrait = blur > 0f
      if (portrait) {
        ensurePortraitTargets()
        renderCopy(blurFbo, blurW, blurH)
        if (!livePortrait.busy && now - lastSeg >= SEG_INTERVAL_MS) {
          lastSeg = now
          submitForSegmentation()
        }
      } else if (portraitWasOn) {
        hasSubject = false
        livePortrait.reset()
      }
      portraitWasOn = portrait
      val suggest = sceneSuggest && !portrait
      if (suggest && !scene.busy && now - lastScene >= SCENE_INTERVAL_MS) {
        lastScene = now
        ensurePortraitTargets()
        readSegmentationCopy()?.let { scene.submit(it, segW, segH) }
      } else if (!suggest && sceneWasOn) {
        scene.reset()
      }
      sceneWasOn = suggest

      GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
      // Black around the frame, the camera picture only inside it.
      GLES20.glViewport(0, 0, viewWidth, viewHeight)
      GLES20.glClearColor(0f, 0f, 0f, 1f)
      GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
      GLES20.glViewport(frameX, frameYgl, frameW, frameH)
      GLES20.glUseProgram(program)
      GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
      GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, oesTexture)
      GLES20.glUniform1i(GLES20.glGetUniformLocation(program, "uCam"), 0)
      GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(program, "uTexMatrix"), 1, false, stMatrix, 0)
      GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(program, "uUvMatrix"), 1, false, uvMatrix, 0)
      // Night: read the averaged frame instead of the raw camera frame, and lift it like the photo.
      GLES20.glActiveTexture(GLES20.GL_TEXTURE4)
      GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, accumulated)
      GLES20.glUniform1i(GLES20.glGetUniformLocation(program, "uAccum"), 4)
      GLES20.glUniform1f(GLES20.glGetUniformLocation(program, "uUseAccum"), if (accumulated != 0) 1f else 0f)
      GLES20.glUniform1f(GLES20.glGetUniformLocation(program, "uLift"), if (night) nightLift else 1f)

      val lutMix = bindLut()
      GLES20.glUniform1i(GLES20.glGetUniformLocation(program, "uLut"), 1)
      GLES20.glUniform1f(GLES20.glGetUniformLocation(program, "uLutMix"), lutMix)
      GLES20.glUniform1f(GLES20.glGetUniformLocation(program, "uZebra"), if (a.zebra) a.zebraLevel.toFloat() else 2f)
      GLES20.glUniform1f(GLES20.glGetUniformLocation(program, "uPeaking"), if (a.peaking) 1f else 0f)
      GLES20.glUniform1f(GLES20.glGetUniformLocation(program, "uFalseColor"), if (a.falseColor) 1f else 0f)
      // Peaking compares neighbours ~1/360 of the frame apart (like iOS's 360 px analysis).
      GLES20.glUniform2f(GLES20.glGetUniformLocation(program, "uStep"), 1f / 360f, 1f / 360f)
      val blurOn = portrait && hasSubject && maskTexture != 0 && blurTexture != 0
      GLES20.glActiveTexture(GLES20.GL_TEXTURE2)
      GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, blurTexture)
      GLES20.glUniform1i(GLES20.glGetUniformLocation(program, "uBlurTex"), 2)
      GLES20.glActiveTexture(GLES20.GL_TEXTURE3)
      GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, maskTexture)
      GLES20.glUniform1i(GLES20.glGetUniformLocation(program, "uMask"), 3)
      GLES20.glUniform1f(GLES20.glGetUniformLocation(program, "uPortrait"), if (blurOn) 1f else 0f)
      GLES20.glUniform1f(GLES20.glGetUniformLocation(program, "uStyle"), if (blurOn) portraitStyle else 0f)
      // Radius in view uv: same fraction of the long side as the saved photo's blur.
      val radiusFrac = if (portraitAuto && hasSubject) {
        expo.modules.lenscamera.imaging.PortraitStyle.blurFraction(expo.modules.lenscamera.imaging.PortraitStyle.autoAperture(livePortrait.coverage))
      } else blur
      val radiusPx = radiusFrac * max(frameW, frameH)
      GLES20.glUniform2f(GLES20.glGetUniformLocation(program, "uBlurRadius"), radiusPx / frameW, radiusPx / frameH)
      GlUtil.drawQuad(program)
      core.setPresentationTime(window, st.timestamp)
      core.swap(window)
      framesDrawn++
      if (lapse && now - timeLapseLast >= TimeLapseEncoder.intervalMs(now - timeLapseStart)) {
        timeLapseLast = now
        drawTimeLapseFrame(core)
      }
      updateMotion(core, st.timestamp)
      if (firstFrame) {
        firstFrame = false
        Log.i(TAG, "first frame ${bufferSize.width}x${bufferSize.height} rotation $rotationDegrees target $targetRotation cameraTransform $hasCameraTransform (st ${stMatrixRotation()}) view ${viewWidth}x$viewHeight")
        mainHandler.post { onFirstFrame?.invoke() }
      }
    } catch (e: Exception) {
      Log.w(TAG, "draw failed", e)
    }
  }

  private fun bindLut(): Float {
    val id = look
    val amount = lookIntensity.toFloat().coerceIn(0f, 1f)
    GLES20.glActiveTexture(GLES20.GL_TEXTURE1)
    if (id == null || amount <= 0.001f) {
      GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, lutTexture)
      return 0f
    }
    if (id != lutId) {
      val strip = LookStore.strip(context, id) ?: return 0f
      if (lutTexture != 0) GLES20.glDeleteTextures(1, intArrayOf(lutTexture), 0)
      val n = expo.modules.lenscamera.LookLut.SIZE
      lutTexture = GlUtil.texture2d(n * n, n, ByteBuffer.wrap(strip).let { b ->
        ByteBuffer.allocateDirect(strip.size).order(ByteOrder.nativeOrder()).put(b).also { it.position(0) }
      })
      lutId = id
    }
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, lutTexture)
    return amount
  }

  /**
   * View uv (0…1, origin bottom-left) -> uv of the image the SurfaceTexture
   * matrix gives us: centre-crop to fill the view ("aspect fill", like iOS),
   * then rotate/mirror the way CameraX's own PreviewView does:
   *
   * - The camera already applied its transform (camera writes straight into our
   *   SurfaceTexture, e.g. Galaxy S8): stMatrix holds the sensor rotation and the
   *   front-camera mirror for the phone's natural (portrait) orientation. Only
   *   the screen rotation is left to undo, and nothing is mirrored again.
   * - Otherwise the buffer is in sensor orientation: rotate by CameraX's
   *   rotationDegrees (clockwise on screen = counter-clockwise for view -> buffer
   *   in bottom-up uv) and mirror if CameraX says so.
   *
   * Earlier versions combined rotationDegrees with the angle read back out of
   * stMatrix; that depended on the phone and on sign guesses (dev-23…30).
   */
  /** Viewfinder: uv matrix for the view, plus the tap-to-focus mapping. */
  private fun computeUvMatrix() {
    computeUvMatrix(frameW, frameH, uvMatrix)
    // Tap-to-focus uses exactly what the shader samples: the texture
    // coordinate, which is the buffer position (origin top-left).
    val m = FloatArray(16)
    Matrix.multiplyMM(m, 0, stMatrix, 0, uvMatrix, 0)
    focusMatrix = m
  }

  /** The same mapping for any target size (aspect-fill crop), e.g. the 16:9 time-lapse frame. */
  private fun computeUvMatrix(targetW: Int, targetH: Int, out: FloatArray) {
    val degrees = if (hasCameraTransform) {
      Math.floorMod(-surfaceDegrees(targetRotation), 360)
    } else {
      Math.floorMod(rotationDegrees, 360)
    }
    val mirror = !hasCameraTransform && isMirroring
    val rotated = rotationDegrees % 180 != 0
    val bw = (if (rotated) bufferSize.height else bufferSize.width).toFloat()
    val bh = (if (rotated) bufferSize.width else bufferSize.height).toFloat()
    val scale = max(targetW / bw, targetH / bh)
    val fx = targetW / (bw * scale)
    val fy = targetH / (bh * scale)
    Matrix.setIdentityM(out, 0)
    Matrix.translateM(out, 0, 0.5f, 0.5f, 0f)
    Matrix.rotateM(out, 0, degrees.toFloat(), 0f, 0f, 1f)
    if (mirror) Matrix.scaleM(out, 0, -1f, 1f, 1f)
    Matrix.scaleM(out, 0, fx, fy, 1f)
    Matrix.translateM(out, 0, -0.5f, -0.5f, 0f)
  }

  private fun surfaceDegrees(rotation: Int) = when (rotation) {
    Surface.ROTATION_90 -> 90
    Surface.ROTATION_180 -> 180
    Surface.ROTATION_270 -> 270
    else -> 0
  }

  /**
   * The rotation inside the SurfaceTexture matrix (0/90/180/270). That matrix is
   * flipV · crop · bufferTransform; undo the flip, then read the angle (crop
   * only scales, so the signs, and the snapped angle, survive).
   */
  private fun stMatrixRotation(): Int {
    val angle = Math.toDegrees(kotlin.math.atan2(-stMatrix[1].toDouble(), stMatrix[0].toDouble()))
    return Math.floorMod((Math.round(angle / 90.0) * 90).toInt(), 360)
  }

  // ---------- Time-lapse ----------

  /**
   * Start a time-lapse into [file]: 16:9 in the screen's orientation (what the
   * viewfinder shows, cropped to 16:9), up to 1920 px on the long side.
   * [done] gets { uri, duration, frames } when [stopTimeLapse] finishes it.
   */
  fun startTimeLapse(file: java.io.File, done: (Result<Map<String, Any?>>) -> Unit) {
    gl.post {
      val core = egl
      if (core == null || failed || !recordable) {
        done(Result.failure(IllegalStateException("Time-lapse isn't available on this phone (no recordable GPU surface).")))
        return@post
      }
      if (timeLapse != null) {
        done(Result.failure(IllegalStateException("Already recording a time-lapse.")))
        return@post
      }
      try {
        val landscape = viewWidth >= viewHeight
        // Long side: the camera buffer's long side, at most 1920 (never upscale), even numbers.
        val long = minOf(1920, max(bufferSize.width, bufferSize.height)).let { it - it % 2 }
        val short = (long * 9 / 16).let { it - it % 2 }
        val (w, h) = if (landscape) long to short else short to long
        val encoder = TimeLapseEncoder(w, h, file)
        timeLapseSurface = core.windowSurface(encoder.inputSurface)
        timeLapse = encoder
        timeLapseDone = done
        timeLapseFile = file
        timeLapseStart = SystemClock.uptimeMillis()
        timeLapseLast = 0L
        smoothLuma = -1f
        Log.i(TAG, "time-lapse ${w}x$h")
      } catch (e: Exception) {
        Log.w(TAG, "time-lapse start failed", e)
        done(Result.failure(e))
      }
    }
  }

  fun stopTimeLapse() {
    gl.post {
      val encoder = timeLapse ?: return@post
      timeLapse = null
      val done = timeLapseDone
      timeLapseDone = null
      egl?.let { core ->
        core.makeCurrent(if (window != EGL14.EGL_NO_SURFACE) window else pbuffer)
        if (timeLapseSurface != EGL14.EGL_NO_SURFACE) core.releaseSurface(timeLapseSurface)
      }
      timeLapseSurface = EGL14.EGL_NO_SURFACE
      val frames = encoder.frames
      val duration = encoder.finish()
      val file = timeLapseFile
      timeLapseFile = null
      if (duration > 0 && file != null) {
        done?.invoke(Result.success(mapOf("uri" to "file://${file.absolutePath}", "duration" to duration, "frames" to frames)))
      } else {
        done?.invoke(Result.failure(IllegalStateException("The time-lapse was too short (no frames).")))
      }
    }
  }

  /** One frame into the encoder: the camera frame, upright, 16:9, brightness evened out (deflicker). */
  private fun drawTimeLapseFrame(core: EglCore) {
    val encoder = timeLapse ?: return
    try {
      core.makeCurrent(timeLapseSurface)
      computeUvMatrix(encoder.width, encoder.height, timeLapseUv)
      GLES20.glViewport(0, 0, encoder.width, encoder.height)
      GLES20.glUseProgram(copyProgram)
      GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
      GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, oesTexture)
      GLES20.glUniform1i(GLES20.glGetUniformLocation(copyProgram, "uCam"), 0)
      GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(copyProgram, "uTexMatrix"), 1, false, stMatrix, 0)
      GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(copyProgram, "uUvMatrix"), 1, false, timeLapseUv, 0)
      // No neighbour averaging for the video (full sharpness).
      GLES20.glUniform2f(GLES20.glGetUniformLocation(copyProgram, "uStep"), 0f, 0f)
      // Deflicker: pull this frame's brightness toward the running average (±15 % at most).
      val mean = meanLuma
      val gain = if (mean > 1f) {
        smoothLuma = if (smoothLuma < 0f) mean else smoothLuma * 0.85f + mean * 0.15f
        (smoothLuma / mean).coerceIn(0.87f, 1.15f)
      } else 1f
      GLES20.glUniform1f(GLES20.glGetUniformLocation(copyProgram, "uGain"), gain)
      GlUtil.drawQuad(copyProgram)
      core.setPresentationTime(timeLapseSurface, encoder.nextPresentationNs())
      core.swap(timeLapseSurface)
      encoder.frameDrawn()
    } catch (e: Exception) {
      Log.w(TAG, "time-lapse frame failed", e)
    } finally {
      core.makeCurrent(if (window != EGL14.EGL_NO_SURFACE) window else pbuffer)
    }
  }

  // ---------- Motion photos ----------

  /** Feed (or start/stop) the motion clip encoder with this frame: the full 4:3 photo shape, upright, ≤ 1280 px. */
  private fun updateMotion(core: EglCore, timestampNs: Long) {
    if (!motionPhoto || !recordable || timeLapse != null) {
      if (motion != null) stopMotion(core)
      return
    }
    val landscape = viewWidth >= viewHeight
    val long = minOf(1280, max(bufferSize.width, bufferSize.height)).let { it - it % 16 }
    val short = (long * 3 / 4).let { it - it % 16 }
    val (w, h) = if (landscape) long to short else short to long
    var clip = motion
    if (clip != null && (clip.width != w || clip.height != h)) {
      stopMotion(core)
      clip = null
    }
    if (clip == null) {
      clip = runCatching { MotionClip(w, h) }.onFailure { Log.w(TAG, "motion clip encoder failed", it) }.getOrNull() ?: run {
        motionPhoto = false
        return
      }
      motionSurface = core.windowSurface(clip.inputSurface)
      motion = clip
      Log.i(TAG, "motion clip ${w}x$h")
    }
    // 30 fps at most (the viewfinder may draw faster).
    if (timestampNs - lastMotionNs < 30_000_000L) return
    lastMotionNs = timestampNs
    try {
      core.makeCurrent(motionSurface)
      computeUvMatrix(w, h, motionUv)
      GLES20.glViewport(0, 0, w, h)
      GLES20.glUseProgram(copyProgram)
      GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
      GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, oesTexture)
      GLES20.glUniform1i(GLES20.glGetUniformLocation(copyProgram, "uCam"), 0)
      GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(copyProgram, "uTexMatrix"), 1, false, stMatrix, 0)
      GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(copyProgram, "uUvMatrix"), 1, false, motionUv, 0)
      GLES20.glUniform2f(GLES20.glGetUniformLocation(copyProgram, "uStep"), 0f, 0f)
      GLES20.glUniform1f(GLES20.glGetUniformLocation(copyProgram, "uGain"), 1f)
      GlUtil.drawQuad(copyProgram)
      core.setPresentationTime(motionSurface, timestampNs)
      core.swap(motionSurface)
      clip.frameDrawn(timestampNs / 1000)
    } catch (e: Exception) {
      Log.w(TAG, "motion frame failed", e)
    } finally {
      core.makeCurrent(if (window != EGL14.EGL_NO_SURFACE) window else pbuffer)
    }
  }

  private fun stopMotion(core: EglCore?) {
    core?.makeCurrent(if (window != EGL14.EGL_NO_SURFACE) window else pbuffer)
    if (motionSurface != EGL14.EGL_NO_SURFACE) core?.releaseSurface(motionSurface)
    motionSurface = EGL14.EGL_NO_SURFACE
    motion?.release()
    motion = null
  }

  /**
   * The motion clip around now (the shot) into [file]: [done] gets (file, still
   * time in the clip in µs) about 1.5 s later, or a failure when Motion is off.
   */
  fun motionClip(file: java.io.File, done: (Result<Pair<java.io.File, Long>>) -> Unit) {
    gl.post {
      val clip = motion ?: return@post done(Result.failure(IllegalStateException("Motion is off")))
      clip.capture(file, done)
    }
  }

  // ---------- Photo from the video frame ----------

  /**
   * Photo while recording on phones that can't run a photo stream next to the
   * video (checklist 3.7): the current camera frame (as the video sees it: 16:9,
   * upright, up to the stream's resolution), saved as a JPEG. Never upscaled.
   */
  fun snapshot(file: java.io.File, done: (Result<Map<String, Any?>>) -> Unit) {
    gl.post {
      val core = egl
      if (core == null || failed || oesTexture == 0) {
        done(Result.failure(IllegalStateException("No camera frame yet.")))
        return@post
      }
      var fbo = 0
      var tex = 0
      try {
        core.makeCurrent(if (window != EGL14.EGL_NO_SURFACE) window else pbuffer)
        val landscape = viewWidth >= viewHeight
        val long = max(bufferSize.width, bufferSize.height).let { it - it % 2 }
        val short = (long * 9 / 16).let { it - it % 2 }
        val (w, h) = if (landscape) long to short else short to long
        val target = GlUtil.framebuffer(w, h)
        tex = target.first
        fbo = target.second
        val uv = FloatArray(16)
        computeUvMatrix(w, h, uv)
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fbo)
        GLES20.glViewport(0, 0, w, h)
        GLES20.glUseProgram(copyProgram)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, oesTexture)
        GLES20.glUniform1i(GLES20.glGetUniformLocation(copyProgram, "uCam"), 0)
        GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(copyProgram, "uTexMatrix"), 1, false, stMatrix, 0)
        GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(copyProgram, "uUvMatrix"), 1, false, uv, 0)
        GLES20.glUniform2f(GLES20.glGetUniformLocation(copyProgram, "uStep"), 0f, 0f)
        GLES20.glUniform1f(GLES20.glGetUniformLocation(copyProgram, "uGain"), 1f)
        GlUtil.drawQuad(copyProgram)
        val pixels = ByteBuffer.allocateDirect(w * h * 4).order(ByteOrder.nativeOrder())
        GLES20.glReadPixels(0, 0, w, h, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, pixels)
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
        // Off the GL thread: flip (GL rows are bottom-up) and encode.
        Thread {
          try {
            pixels.position(0)
            val raw = android.graphics.Bitmap.createBitmap(w, h, android.graphics.Bitmap.Config.ARGB_8888)
            raw.copyPixelsFromBuffer(pixels)
            val flip = android.graphics.Matrix().apply { postScale(1f, -1f) }
            val upright = android.graphics.Bitmap.createBitmap(raw, 0, 0, w, h, flip, false)
            raw.recycle()
            file.outputStream().use { upright.compress(android.graphics.Bitmap.CompressFormat.JPEG, 95, it) }
            upright.recycle()
            runCatching {
              val exif = androidx.exifinterface.media.ExifInterface(file)
              val now = java.text.SimpleDateFormat("yyyy:MM:dd HH:mm:ss", java.util.Locale.US).format(java.util.Date())
              exif.setAttribute(androidx.exifinterface.media.ExifInterface.TAG_DATETIME_ORIGINAL, now)
              exif.setAttribute(androidx.exifinterface.media.ExifInterface.TAG_DATETIME, now)
              exif.saveAttributes()
            }
            done(Result.success(mapOf("uri" to "file://${file.absolutePath}", "width" to w, "height" to h, "raw" to false, "fromVideo" to true)))
          } catch (e: Exception) {
            done(Result.failure(e))
          }
        }.start()
      } catch (e: Exception) {
        Log.w(TAG, "snapshot failed", e)
        done(Result.failure(e))
      } finally {
        if (fbo != 0) GLES20.glDeleteFramebuffers(1, intArrayOf(fbo), 0)
        if (tex != 0) GLES20.glDeleteTextures(1, intArrayOf(tex), 0)
      }
    }
  }

  // ---------- Night ----------

  /**
   * Averages the new camera frame into the running night frame (view size,
   * ping-pong). Returns the texture to show, or 0 if it couldn't be made.
   */
  private fun accumulate(): Int {
    val w = frameW
    val h = frameH
    try {
      if (w != accumW || h != accumH || accumFbo[0] == 0) {
        for (i in 0..1) deleteTarget(accumTex[i], accumFbo[i])
        for (i in 0..1) {
          val (tex, fbo) = GlUtil.framebuffer(w, h)
          accumTex[i] = tex
          accumFbo[i] = fbo
        }
        accumW = w
        accumH = h
        accumValid = false
      }
    } catch (e: Exception) {
      Log.w(TAG, "night preview buffers failed", e)
      return 0
    }
    val prev = accumIndex
    val next = 1 - accumIndex
    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, accumFbo[next])
    GLES20.glViewport(0, 0, w, h)
    GLES20.glUseProgram(accumProgram)
    GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, oesTexture)
    GLES20.glUniform1i(GLES20.glGetUniformLocation(accumProgram, "uCam"), 0)
    GLES20.glActiveTexture(GLES20.GL_TEXTURE1)
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, accumTex[prev])
    GLES20.glUniform1i(GLES20.glGetUniformLocation(accumProgram, "uPrev"), 1)
    GLES20.glUniform1f(GLES20.glGetUniformLocation(accumProgram, "uHasPrev"), if (accumValid) 1f else 0f)
    GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(accumProgram, "uTexMatrix"), 1, false, stMatrix, 0)
    GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(accumProgram, "uUvMatrix"), 1, false, uvMatrix, 0)
    GlUtil.drawQuad(accumProgram)
    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
    accumIndex = next
    accumValid = true
    return accumTex[next]
  }

  // ---------- Portrait ----------

  /** ¼-size blur source and the ~320 px segmentation copy, sized to the view (same aspect). */
  private fun ensurePortraitTargets() {
    val bw = max(1, frameW / 4)
    val bh = max(1, frameH / 4)
    if (bw != blurW || bh != blurH || blurFbo == 0) {
      deleteTarget(blurTexture, blurFbo)
      val (tex, fbo) = GlUtil.framebuffer(bw, bh)
      blurTexture = tex
      blurFbo = fbo
      blurW = bw
      blurH = bh
    }
    val long = SEG_LONG_SIDE.toFloat()
    val sw = if (frameW >= frameH) SEG_LONG_SIDE else max(1, (long * frameW / frameH).toInt())
    val sh = if (frameW >= frameH) max(1, (long * frameH / frameW).toInt()) else SEG_LONG_SIDE
    if (sw != segW || sh != segH || segFbo == 0) {
      deleteTarget(segTexture, segFbo)
      val (tex, fbo) = GlUtil.framebuffer(sw, sh)
      segTexture = tex
      segFbo = fbo
      segW = sw
      segH = sh
      segPixels = ByteBuffer.allocateDirect(sw * sh * 4).order(ByteOrder.nativeOrder())
      // A mask from the old size/orientation would land in the wrong place.
      hasSubject = false
      livePortrait.reset()
    }
  }

  private fun deleteTarget(texture: Int, fbo: Int) {
    if (texture != 0) GLES20.glDeleteTextures(1, intArrayOf(texture), 0)
    if (fbo != 0) GLES20.glDeleteFramebuffers(1, intArrayOf(fbo), 0)
  }

  /** The visible frame (no look, no overlays), as shown on screen, into [fbo]. */
  private fun renderCopy(fbo: Int, width: Int, height: Int) {
    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fbo)
    GLES20.glViewport(0, 0, width, height)
    GLES20.glUseProgram(copyProgram)
    GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, oesTexture)
    GLES20.glUniform1i(GLES20.glGetUniformLocation(copyProgram, "uCam"), 0)
    GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(copyProgram, "uTexMatrix"), 1, false, stMatrix, 0)
    GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(copyProgram, "uUvMatrix"), 1, false, uvMatrix, 0)
    // Average 4 nearby camera pixels per output pixel: a smoother small copy.
    GLES20.glUniform2f(GLES20.glGetUniformLocation(copyProgram, "uStep"), 1f / 720f, 1f / 720f)
    GLES20.glUniform1f(GLES20.glGetUniformLocation(copyProgram, "uGain"), 1f)
    GlUtil.drawQuad(copyProgram)
    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
  }

  private fun submitForSegmentation() {
    readSegmentationCopy()?.let { livePortrait.submit(it, segW, segH) }
  }

  /** The ~320 px copy of the visible frame (RGBA, bottom row first), for the ML models. */
  private fun readSegmentationCopy(): ByteArray? {
    val buffer = segPixels ?: return null
    renderCopy(segFbo, segW, segH)
    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, segFbo)
    buffer.position(0)
    GLES20.glReadPixels(0, 0, segW, segH, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, buffer)
    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
    val bytes = ByteArray(segW * segH * 4)
    buffer.position(0)
    buffer.get(bytes)
    return bytes
  }

  /** GL thread: a new mask from [LivePortrait] (top row first, 1 byte per pixel). */
  private fun uploadMask(mask: ByteBuffer, width: Int, height: Int, subject: Boolean) {
    val core = egl ?: return
    if (portraitBlur <= 0f) return
    core.makeCurrent(if (window != EGL14.EGL_NO_SURFACE) window else pbuffer)
    if (maskTexture == 0) {
      val t = IntArray(1)
      GLES20.glGenTextures(1, t, 0)
      maskTexture = t[0]
      GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, maskTexture)
      GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
      GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
      GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
      GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
    }
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, maskTexture)
    GLES20.glPixelStorei(GLES20.GL_UNPACK_ALIGNMENT, 1)
    GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_LUMINANCE, width, height, 0, GLES20.GL_LUMINANCE, GLES20.GL_UNSIGNED_BYTE, mask)
    GLES20.glPixelStorei(GLES20.GL_UNPACK_ALIGNMENT, 4)
    hasSubject = subject
  }

  private fun runAnalysis(sendHistogram: Boolean, night: Boolean) {
    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, analysisFbo)
    GLES20.glViewport(0, 0, AW, AH)
    GLES20.glUseProgram(analysisProgram)
    GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, oesTexture)
    GLES20.glUniform1i(GLES20.glGetUniformLocation(analysisProgram, "uCam"), 0)
    GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(analysisProgram, "uTexMatrix"), 1, false, stMatrix, 0)
    GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(analysisProgram, "uUvMatrix"), 1, false, uvMatrix, 0)
    GlUtil.drawQuad(analysisProgram)
    analysisPixels.position(0)
    GLES20.glReadPixels(0, 0, AW, AH, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, analysisPixels)
    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)

    val bins = IntArray(64)
    val counts = IntArray(256)
    var low = 0
    var high = 0
    var sum = 0L
    for (i in 0 until AW * AH) {
      val l = analysisPixels.get(i * 4).toInt() and 0xFF // luma is written to red
      sum += l
      bins[l shr 2]++
      counts[l]++
      if (l <= 4) low++
      if (l >= 251) high++
    }
    meanLuma = sum.toFloat() / (AW * AH)
    if (night) {
      // Same lift as the night photo (NightMerge.shadowLift on the median brightness).
      var seen = 0
      var median = 0
      while (median < 255 && seen + counts[median] <= AW * AH / 2) {
        seen += counts[median]
        median++
      }
      nightLiftTarget = expo.modules.lenscamera.NightMerge.liftForMedian(median).toFloat()
    }
    if (!sendHistogram) return
    val peak = max(1, bins.maxOrNull() ?: 1).toDouble()
    val histogram = DoubleArray(64) { Math.round(bins[it] / peak * 1000) / 1000.0 }
    val total = (AW * AH).toDouble()
    mainHandler.post { onHistogram?.invoke(histogram, low / total, high / total) }
  }

  // ---------- Coordinates ----------

  /**
   * A point in the view (fractions, origin top-left) as a fraction of the camera
   * buffer (origin top-left), for tap-to-focus. Same transform as the shader.
   */
  fun viewToBuffer(x: Float, y: Float): Pair<Float, Float> {
    // View fractions → fractions of the camera frame inside the view.
    val f = frame
    val fx = ((x - f[0]) / f[2]).coerceIn(0f, 1f)
    val fy = ((y - f[1]) / f[3]).coerceIn(0f, 1f)
    val out = FloatArray(4)
    Matrix.multiplyMV(out, 0, focusMatrix, 0, floatArrayOf(fx, 1 - fy, 0f, 1f), 0)
    return out[0].coerceIn(0f, 1f) to out[1].coerceIn(0f, 1f)
  }

  fun release() {
    livePortrait.close()
    scene.close()
    gl.post {
      timeLapse?.cancel()
      timeLapse = null
      timeLapseDone?.invoke(Result.failure(IllegalStateException("Camera closed")))
      timeLapseDone = null
      stopMotion(egl)
      deleteTarget(blurTexture, blurFbo)
      deleteTarget(segTexture, segFbo)
      for (i in 0..1) deleteTarget(accumTex[i], accumFbo[i])
      if (maskTexture != 0) GLES20.glDeleteTextures(1, intArrayOf(maskTexture), 0)
      releaseInput()
      egl?.let { core ->
        if (window != EGL14.EGL_NO_SURFACE) core.releaseSurface(window)
        if (pbuffer != EGL14.EGL_NO_SURFACE) core.releaseSurface(pbuffer)
        core.release()
      }
      egl = null
      thread.quitSafely()
    }
  }

  companion object {
    private const val TAG = "LensPreview"
    private const val AW = 96
    private const val AH = 72
    /** Live Portrait: the person mask is refreshed this often (~6 a second), on a ~320 px copy. */
    private const val SEG_INTERVAL_MS = 160L
    private const val SEG_LONG_SIDE = 320
    /** Smart look suggestion: one scene label every 1.5 s (cheap; stops when a look is chosen). */
    private const val SCENE_INTERVAL_MS = 1500L

    private const val VERTEX = """
      attribute vec2 aPos;
      attribute vec2 aUv;
      uniform mat4 uTexMatrix;
      uniform mat4 uUvMatrix;
      varying vec2 vTex;
      varying vec2 vView;
      void main() {
        gl_Position = vec4(aPos, 0.0, 1.0);
        vView = aUv;
        vec4 buf = uUvMatrix * vec4(aUv, 0.0, 1.0);
        vTex = (uTexMatrix * vec4(buf.xy, 0.0, 1.0)).xy;
      }
    """

    private const val FRAGMENT = """
      #extension GL_OES_EGL_image_external : require
      // highp where the GPU has it: mediump texture coordinates (fp16) are too
      // coarse for a 1440 px camera frame on Mali GPUs (Galaxy S8): soft preview.
      #ifdef GL_FRAGMENT_PRECISION_HIGH
      precision highp float;
      #else
      precision mediump float;
      #endif
      varying vec2 vTex;
      varying vec2 vView;
      uniform samplerExternalOES uCam;
      uniform sampler2D uLut;
      uniform sampler2D uBlurTex;
      uniform sampler2D uMask;
      uniform float uPortrait;
      uniform vec2 uBlurRadius;
      uniform sampler2D uAccum;
      uniform float uUseAccum;
      uniform float uLift;
      uniform float uStyle;
      uniform float uLutMix;
      uniform float uZebra;
      uniform float uPeaking;
      uniform float uFalseColor;
      uniform vec2 uStep;
      ${GlUtil.LUT_GLSL}
      float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
      ${expo.modules.lenscamera.imaging.PortraitStyle.GLSL}
      // Portrait: the background comes from the ¼-size copy (already soft),
      // spread over a disc, the same reach as the saved photo's blur.
      vec3 portrait(vec3 sharp) {
        // Mask rows are top-first; view uv is bottom-up.
        float subject = smoothstep(0.3, 0.7, texture2D(uMask, vec2(vView.x, 1.0 - vView.y)).r);
        if (subject > 0.995) return sharp;
        vec3 acc = texture2D(uBlurTex, vView).rgb;
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 0.7854;
          vec2 d = vec2(cos(a), sin(a)) * uBlurRadius;
          acc += texture2D(uBlurTex, vView + d).rgb + texture2D(uBlurTex, vView + d * 0.5).rgb;
        }
        return mix(acc / 17.0, sharp, subject);
      }
      // The frame at an offset (in camera-buffer uv): the night average when it's on.
      vec3 cam(vec2 d) {
        if (uUseAccum > 0.5) return texture2D(uAccum, vView + d).rgb;
        return texture2D(uCam, vTex + d).rgb;
      }
      void main() {
        vec3 c = cam(vec2(0.0));
        if (uLift < 0.999) c = pow(c, vec3(uLift));
        if (uPortrait > 0.5) c = portrait(c);
        float l = luma(c);
        vec3 o = c;
        if (uLutMix > 0.0) o = mix(c, lookup(uLut, c), uLutMix);
        // Same order as the photo: look first, then the portrait style.
        if (uStyle > 0.5) o = portraitStyle(o, smoothstep(0.3, 0.7, texture2D(uMask, vec2(vView.x, 1.0 - vView.y)).r), uStyle);
        if (uFalseColor > 0.5) {
          // IRE zones (same as iOS): purple crushed, blue deep shadow, green
          // middle grey, pink skin, yellow near clip, red clipped; rest grey.
          float ire = l * 100.0;
          vec3 g = vec3(l);
          if (ire < 3.0) g = vec3(0.5, 0.0, 0.78);
          else if (ire < 10.0) g = vec3(0.0, 0.27, 1.0);
          else if (ire >= 38.0 && ire < 45.0) g = vec3(0.0, 0.78, 0.27);
          else if (ire >= 52.0 && ire < 58.0) g = vec3(1.0, 0.55, 0.67);
          else if (ire >= 93.0 && ire < 98.0) g = vec3(1.0, 0.86, 0.0);
          else if (ire >= 98.0) g = vec3(1.0, 0.08, 0.08);
          o = g;
        }
        if (l >= uZebra && mod(gl_FragCoord.x + gl_FragCoord.y, 16.0) < 8.0) {
          o = mix(o, vec3(1.0), 0.9);
        }
        if (uPeaking > 0.5 && l < 0.98) {
          float gx = abs(luma(cam(vec2(uStep.x, 0.0))) - luma(cam(vec2(-uStep.x, 0.0))));
          float gy = abs(luma(cam(vec2(0.0, uStep.y))) - luma(cam(vec2(0.0, -uStep.y))));
          if (gx + gy > 0.19) o = vec3(1.0, 0.12, 0.35);
        }
        gl_FragColor = vec4(o, 1.0);
      }
    """

    /** The visible frame as is (4-tap average), for the Portrait blur source and the person mask. */
    private const val COPY_FRAGMENT = """
      #extension GL_OES_EGL_image_external : require
      #ifdef GL_FRAGMENT_PRECISION_HIGH
      precision highp float;
      #else
      precision mediump float;
      #endif
      varying vec2 vTex;
      uniform samplerExternalOES uCam;
      uniform vec2 uStep;
      uniform float uGain;
      void main() {
        vec3 c = texture2D(uCam, vTex + vec2(uStep.x, uStep.y)).rgb + texture2D(uCam, vTex + vec2(-uStep.x, uStep.y)).rgb
          + texture2D(uCam, vTex + vec2(uStep.x, -uStep.y)).rgb + texture2D(uCam, vTex + vec2(-uStep.x, -uStep.y)).rgb;
        gl_FragColor = vec4(clamp(c * 0.25 * uGain, 0.0, 1.0), 1.0);
      }
    """

    /**
     * Night preview: blend the new frame into the running average (like the
     * burst average: less grain), but follow the new frame where it differs a
     * lot (something moved), so there's no ghosting.
     */
    private const val ACCUM_FRAGMENT = """
      #extension GL_OES_EGL_image_external : require
      #ifdef GL_FRAGMENT_PRECISION_HIGH
      precision highp float;
      #else
      precision mediump float;
      #endif
      varying vec2 vTex;
      varying vec2 vView;
      uniform samplerExternalOES uCam;
      uniform sampler2D uPrev;
      uniform float uHasPrev;
      void main() {
        vec3 cur = texture2D(uCam, vTex).rgb;
        if (uHasPrev < 0.5) { gl_FragColor = vec4(cur, 1.0); return; }
        vec3 prev = texture2D(uPrev, vView).rgb;
        float diff = abs(dot(cur - prev, vec3(0.2126, 0.7152, 0.0722)));
        // ~4 frames of averaging when still; the new frame when it changed.
        float w = mix(0.25, 1.0, smoothstep(0.03, 0.10, diff));
        gl_FragColor = vec4(mix(prev, cur, w), 1.0);
      }
    """

    /** Luma of the visible frame (before looks) into the red channel. */
    private const val ANALYSIS_FRAGMENT = """
      #extension GL_OES_EGL_image_external : require
      // highp where the GPU has it: mediump texture coordinates (fp16) are too
      // coarse for a 1440 px camera frame on Mali GPUs (Galaxy S8): soft preview.
      #ifdef GL_FRAGMENT_PRECISION_HIGH
      precision highp float;
      #else
      precision mediump float;
      #endif
      varying vec2 vTex;
      uniform samplerExternalOES uCam;
      void main() {
        vec3 c = texture2D(uCam, vTex).rgb;
        gl_FragColor = vec4(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), 1.0);
      }
    """
  }
}
