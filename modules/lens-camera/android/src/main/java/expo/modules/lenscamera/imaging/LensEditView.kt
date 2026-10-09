package expo.modules.lenscamera.imaging

import android.content.Context
import android.graphics.Bitmap
import android.opengl.EGL14
import android.opengl.EGLSurface
import android.opengl.GLES20
import android.os.Handler
import android.os.Looper
import android.view.SurfaceHolder
import android.view.SurfaceView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Live editor preview: the photo with the recipe applied, re-rendered on the
 * GPU at screen size on every change (slider drags). Uses the imaging thread's
 * GL context, so it's the exact same renderer as previews and exports.
 */
class LensEditView(context: Context, appContext: AppContext) : ExpoView(context, appContext), SurfaceHolder.Callback {

  private val onRenderError by EventDispatcher<Map<String, Any?>>()

  var uri: String? = null
    set(value) {
      if (value != field) {
        field = value
        load()
      }
    }
  var recipe: EditRecipe? = null
  var showOriginal = false

  private val surfaceView = SurfaceView(context)
  private val engine = ImagingEngine.handler
  private val main = Handler(Looper.getMainLooper())

  // Imaging-thread state.
  private var window: EGLSurface = EGL14.EGL_NO_SURFACE
  private var surfaceWidth = 0
  private var surfaceHeight = 0
  private var sourceTexture = 0
  private var sourceWidth = 0
  private var sourceHeight = 0
  private var storedWidth = 0
  private var storedHeight = 0
  private var orientation = 1
  private var analysis: ImagingEngine.Analysis? = null
  private var maskTexture = 0
  private var renderQueued = false
  private var generation = 0

  init {
    // No background: the SurfaceView shows through a hole in the window, and an
    // opaque background here would cover it.
    surfaceView.holder.addCallback(this)
    addView(surfaceView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  /** React Native sizes this view but never measures its native children: do it here. */
  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    val w = r - l
    val h = b - t
    for (i in 0 until childCount) {
      val child = getChildAt(i)
      child.measure(MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY))
      child.layout(0, 0, w, h)
    }
  }

  fun propsChanged() = scheduleRender()

  private fun load() {
    val target = uri ?: return
    val gen = ++generation
    engine.post {
      try {
        ImagingEngine.ensureGl()
        ImagingEngine.makeOffscreenCurrent()
        releaseSource()
        val source = ImagingEngine.Source(ImagingEngine.fileOf(target))
        try {
          val bitmap: Bitmap = source.small(MAX_PIXEL)
          if (gen != generation) {
            bitmap.recycle()
            return@post
          }
          sourceTexture = ImagingEngine.bitmapTexture(bitmap)
          sourceWidth = bitmap.width
          sourceHeight = bitmap.height
          bitmap.recycle()
          storedWidth = source.width
          storedHeight = source.height
          orientation = source.orientation
          analysis = ImagingEngine.analyse(source)
          maskTexture = Portrait.maskTexture(source.file) ?: 0
        } finally {
          source.close()
        }
        render()
      } catch (e: Exception) {
        main.post { onRenderError(mapOf("message" to (e.message ?: "Could not open this photo"))) }
      }
    }
  }

  private fun releaseSource() {
    ImagingEngine.deleteTexture(sourceTexture)
    analysis?.let { ImagingEngine.deleteTexture(it.base) }
    ImagingEngine.deleteTexture(maskTexture)
    sourceTexture = 0
    maskTexture = 0
    analysis = null
  }

  /** Coalesces rapid recipe changes into one render. */
  private fun scheduleRender() {
    if (renderQueued) return
    renderQueued = true
    engine.post {
      renderQueued = false
      render()
    }
  }

  private fun render() {
    val core = ImagingEngine.eglCore ?: return
    val a = analysis ?: return
    if (window == EGL14.EGL_NO_SURFACE || sourceTexture == 0 || surfaceWidth == 0) return
    val renderer = ImagingEngine.ensureGl()
    val current = if (showOriginal) null else recipe
    val geometry = Geometry(storedWidth, storedHeight, orientation, current?.crop)
    val scale = min(surfaceWidth / geometry.outputWidth.toDouble(), surfaceHeight / geometry.outputHeight.toDouble())
    val w = max(1, (geometry.outputWidth * scale).roundToInt())
    val h = max(1, (geometry.outputHeight * scale).roundToInt())
    core.makeCurrent(window)
    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
    GLES20.glViewport(0, 0, surfaceWidth, surfaceHeight)
    GLES20.glClearColor(0f, 0f, 0f, 1f)
    GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
    GLES20.glViewport((surfaceWidth - w) / 2, (surfaceHeight - h) / 2, w, h)
    val inputs = EditRenderer.Inputs(
      source = sourceTexture,
      region = floatArrayOf(0f, 0f, 1f, 1f),
      sourceWidth = sourceWidth,
      sourceHeight = sourceHeight,
      base = a.base,
      mask = maskTexture,
      lut = ImagingEngine.lutTexture(context, current?.look),
      geometry = geometry.matrix,
      outputWidth = w,
      outputHeight = h,
    )
    renderer.draw(current, a.auto, inputs, 0, 0, w, h, flipY = true)
    core.swap(window)
    ImagingEngine.makeOffscreenCurrent()
  }

  override fun surfaceCreated(holder: SurfaceHolder) {}

  override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
    val surface = holder.surface
    engine.post {
      try {
        val core = ImagingEngine.eglCore ?: run {
          ImagingEngine.ensureGl()
          ImagingEngine.eglCore!!
        }
        if (window == EGL14.EGL_NO_SURFACE) window = core.windowSurface(surface)
        surfaceWidth = width
        surfaceHeight = height
        render()
      } catch (e: Exception) {
        main.post { onRenderError(mapOf("message" to (e.message ?: "Display failed"))) }
      }
    }
  }

  override fun surfaceDestroyed(holder: SurfaceHolder) {
    val done = java.util.concurrent.CountDownLatch(1)
    engine.post {
      ImagingEngine.eglCore?.let { core ->
        if (window != EGL14.EGL_NO_SURFACE) {
          ImagingEngine.makeOffscreenCurrent()
          core.releaseSurface(window)
          window = EGL14.EGL_NO_SURFACE
        }
      }
      done.countDown()
    }
    done.await(500, java.util.concurrent.TimeUnit.MILLISECONDS)
  }

  fun destroy() {
    generation++
    engine.post {
      ImagingEngine.makeOffscreenCurrent()
      releaseSource()
    }
  }

  companion object {
    /** Same as iOS: the editor works on a screen-size copy; exports use the original. */
    private const val MAX_PIXEL = 1800
  }
}
