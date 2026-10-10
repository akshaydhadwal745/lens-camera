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

/**
 * The viewfinder: camera frames drawn with OpenGL ES 2.0 onto a SurfaceView.
 *
 * One pass per frame applies the live look (one LUT lookup) and the monitoring
 * overlays (zebra, focus peaking, false colour). Four times a second a tiny
 * 96×72 copy is read back for the histogram. No extra camera stream is needed
 * for any of it, and the photo/video files are never touched (looks stay a
 * removable edit).
 */
class GlPreview(private val context: Context) : Preview.SurfaceProvider, SurfaceHolder.Callback {
  val view = SurfaceView(context)

  /** Histogram results: 64 bins normalised to the peak, plus clip fractions. */
  var onHistogram: ((DoubleArray, Double, Double) -> Unit)? = null
  /** GL couldn't start on this phone; the owner falls back to a plain preview. */
  var onFailed: ((String) -> Unit)? = null
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

  // Set from the main thread, read on the GL thread.
  @Volatile var look: String? = null
  @Volatile var lookIntensity = 1.0
  @Volatile var analysis = AnalysisOptions()
  @Volatile var paused = false

  init {
    view.holder.addCallback(this)
    gl.post { setUpGl() }
  }

  private fun setUpGl() {
    try {
      val core = EglCore()
      egl = core
      pbuffer = core.pbuffer()
      core.makeCurrent(pbuffer)
      program = GlUtil.program(VERTEX, FRAGMENT)
      analysisProgram = GlUtil.program(VERTEX, ANALYSIS_FRAGMENT)
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
      if (a.histogram && onHistogram != null && now - lastAnalysis >= 250) {
        lastAnalysis = now
        runAnalysis()
      }

      GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
      GLES20.glViewport(0, 0, viewWidth, viewHeight)
      GLES20.glUseProgram(program)
      GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
      GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, oesTexture)
      GLES20.glUniform1i(GLES20.glGetUniformLocation(program, "uCam"), 0)
      GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(program, "uTexMatrix"), 1, false, stMatrix, 0)
      GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(program, "uUvMatrix"), 1, false, uvMatrix, 0)

      val lutMix = bindLut()
      GLES20.glUniform1i(GLES20.glGetUniformLocation(program, "uLut"), 1)
      GLES20.glUniform1f(GLES20.glGetUniformLocation(program, "uLutMix"), lutMix)
      GLES20.glUniform1f(GLES20.glGetUniformLocation(program, "uZebra"), if (a.zebra) a.zebraLevel.toFloat() else 2f)
      GLES20.glUniform1f(GLES20.glGetUniformLocation(program, "uPeaking"), if (a.peaking) 1f else 0f)
      GLES20.glUniform1f(GLES20.glGetUniformLocation(program, "uFalseColor"), if (a.falseColor) 1f else 0f)
      // Peaking compares neighbours ~1/360 of the frame apart (like iOS's 360 px analysis).
      GLES20.glUniform2f(GLES20.glGetUniformLocation(program, "uStep"), 1f / 360f, 1f / 360f)
      GlUtil.drawQuad(program)
      core.setPresentationTime(window, st.timestamp)
      core.swap(window)
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
  private fun computeUvMatrix() {
    val degrees = if (hasCameraTransform) {
      Math.floorMod(-surfaceDegrees(targetRotation), 360)
    } else {
      Math.floorMod(rotationDegrees, 360)
    }
    val mirror = !hasCameraTransform && isMirroring
    val rotated = rotationDegrees % 180 != 0
    val bw = (if (rotated) bufferSize.height else bufferSize.width).toFloat()
    val bh = (if (rotated) bufferSize.width else bufferSize.height).toFloat()
    val scale = max(viewWidth / bw, viewHeight / bh)
    val fx = viewWidth / (bw * scale)
    val fy = viewHeight / (bh * scale)
    Matrix.setIdentityM(uvMatrix, 0)
    Matrix.translateM(uvMatrix, 0, 0.5f, 0.5f, 0f)
    Matrix.rotateM(uvMatrix, 0, degrees.toFloat(), 0f, 0f, 1f)
    if (mirror) Matrix.scaleM(uvMatrix, 0, -1f, 1f, 1f)
    Matrix.scaleM(uvMatrix, 0, fx, fy, 1f)
    Matrix.translateM(uvMatrix, 0, -0.5f, -0.5f, 0f)
    // Tap-to-focus uses exactly what the shader samples: the texture
    // coordinate, which is the buffer position (origin top-left).
    val m = FloatArray(16)
    Matrix.multiplyMM(m, 0, stMatrix, 0, uvMatrix, 0)
    focusMatrix = m
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

  private fun runAnalysis() {
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
    var low = 0
    var high = 0
    for (i in 0 until AW * AH) {
      val l = analysisPixels.get(i * 4).toInt() and 0xFF // luma is written to red
      bins[l shr 2]++
      if (l <= 4) low++
      if (l >= 251) high++
    }
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
    val out = FloatArray(4)
    Matrix.multiplyMV(out, 0, focusMatrix, 0, floatArrayOf(x, 1 - y, 0f, 1f), 0)
    return out[0].coerceIn(0f, 1f) to out[1].coerceIn(0f, 1f)
  }

  fun release() {
    gl.post {
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

    private const val VERTEX = """
      attribute vec2 aPos;
      attribute vec2 aUv;
      uniform mat4 uTexMatrix;
      uniform mat4 uUvMatrix;
      varying vec2 vTex;
      void main() {
        gl_Position = vec4(aPos, 0.0, 1.0);
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
      uniform samplerExternalOES uCam;
      uniform sampler2D uLut;
      uniform float uLutMix;
      uniform float uZebra;
      uniform float uPeaking;
      uniform float uFalseColor;
      uniform vec2 uStep;
      ${GlUtil.LUT_GLSL}
      float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
      void main() {
        vec3 c = texture2D(uCam, vTex).rgb;
        float l = luma(c);
        vec3 o = c;
        if (uLutMix > 0.0) o = mix(c, lookup(uLut, c), uLutMix);
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
          float gx = abs(luma(texture2D(uCam, vTex + vec2(uStep.x, 0.0)).rgb) - luma(texture2D(uCam, vTex - vec2(uStep.x, 0.0)).rgb));
          float gy = abs(luma(texture2D(uCam, vTex + vec2(0.0, uStep.y)).rgb) - luma(texture2D(uCam, vTex - vec2(0.0, uStep.y)).rgb));
          if (gx + gy > 0.19) o = vec3(1.0, 0.12, 0.35);
        }
        gl_FragColor = vec4(o, 1.0);
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
