package expo.modules.lenscamera.gl

import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLExt
import android.opengl.EGLSurface
import android.opengl.GLES20
import android.view.Surface
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

class GlException(message: String) : RuntimeException(message)

/**
 * Minimal EGL setup: an OpenGL ES 2.0 context (supported by every Android
 * phone, including old Mali-400 class GPUs that lack ES 3.0), window surfaces
 * for on-screen output and a 1×1 pbuffer when only offscreen work is needed.
 */
class EglCore(shared: EGLContext = EGL14.EGL_NO_CONTEXT, recordable: Boolean = false) {
  val display: EGLDisplay = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
  val config: EGLConfig
  val context: EGLContext

  init {
    if (display == EGL14.EGL_NO_DISPLAY) throw GlException("No EGL display")
    val version = IntArray(2)
    if (!EGL14.eglInitialize(display, version, 0, version, 1)) throw GlException("eglInitialize failed")
    val attribs = mutableListOf(
      EGL14.EGL_RED_SIZE, 8,
      EGL14.EGL_GREEN_SIZE, 8,
      EGL14.EGL_BLUE_SIZE, 8,
      EGL14.EGL_ALPHA_SIZE, 8,
      EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
      EGL14.EGL_SURFACE_TYPE, EGL14.EGL_WINDOW_BIT or EGL14.EGL_PBUFFER_BIT,
    )
    // Needed when the surface feeds a video encoder (MediaCodec input surface).
    if (recordable) attribs += listOf(EGLExt.EGL_RECORDABLE_ANDROID, 1)
    attribs += EGL14.EGL_NONE
    val configs = arrayOfNulls<EGLConfig>(1)
    val count = IntArray(1)
    if (!EGL14.eglChooseConfig(display, attribs.toIntArray(), 0, configs, 0, 1, count, 0) || count[0] == 0) {
      throw GlException("No suitable EGL config")
    }
    config = configs[0]!!
    context = EGL14.eglCreateContext(display, config, shared, intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE), 0)
    if (context == EGL14.EGL_NO_CONTEXT) throw GlException("eglCreateContext failed")
  }

  fun windowSurface(surface: Surface): EGLSurface {
    val s = EGL14.eglCreateWindowSurface(display, config, surface, intArrayOf(EGL14.EGL_NONE), 0)
    if (s == EGL14.EGL_NO_SURFACE) throw GlException("eglCreateWindowSurface failed (${EGL14.eglGetError()})")
    return s
  }

  fun pbuffer(): EGLSurface =
    EGL14.eglCreatePbufferSurface(display, config, intArrayOf(EGL14.EGL_WIDTH, 1, EGL14.EGL_HEIGHT, 1, EGL14.EGL_NONE), 0)

  fun makeCurrent(surface: EGLSurface) {
    if (!EGL14.eglMakeCurrent(display, surface, surface, context)) throw GlException("eglMakeCurrent failed (${EGL14.eglGetError()})")
  }

  fun swap(surface: EGLSurface) = EGL14.eglSwapBuffers(display, surface)

  fun setPresentationTime(surface: EGLSurface, nanos: Long) = EGLExt.eglPresentationTimeANDROID(display, surface, nanos)

  fun releaseSurface(surface: EGLSurface) {
    EGL14.eglDestroySurface(display, surface)
  }

  fun release() {
    EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
    EGL14.eglDestroyContext(display, context)
    EGL14.eglReleaseThread()
    EGL14.eglTerminate(display)
  }
}

object GlUtil {
  /** Full-screen quad: x, y (clip space) and u, v (0…1, origin bottom-left). */
  val QUAD: FloatBuffer = floatBuffer(
    floatArrayOf(
      -1f, -1f, 0f, 0f,
      1f, -1f, 1f, 0f,
      -1f, 1f, 0f, 1f,
      1f, 1f, 1f, 1f,
    ),
  )

  fun floatBuffer(values: FloatArray): FloatBuffer =
    ByteBuffer.allocateDirect(values.size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().apply {
      put(values)
      position(0)
    }

  fun program(vertex: String, fragment: String): Int {
    val vs = shader(GLES20.GL_VERTEX_SHADER, vertex)
    val fs = shader(GLES20.GL_FRAGMENT_SHADER, fragment)
    val p = GLES20.glCreateProgram()
    GLES20.glAttachShader(p, vs)
    GLES20.glAttachShader(p, fs)
    GLES20.glBindAttribLocation(p, 0, "aPos")
    GLES20.glBindAttribLocation(p, 1, "aUv")
    GLES20.glLinkProgram(p)
    val ok = IntArray(1)
    GLES20.glGetProgramiv(p, GLES20.GL_LINK_STATUS, ok, 0)
    GLES20.glDeleteShader(vs)
    GLES20.glDeleteShader(fs)
    if (ok[0] == 0) {
      val log = GLES20.glGetProgramInfoLog(p)
      GLES20.glDeleteProgram(p)
      throw GlException("Link failed: $log")
    }
    return p
  }

  private fun shader(type: Int, source: String): Int {
    val s = GLES20.glCreateShader(type)
    GLES20.glShaderSource(s, source)
    GLES20.glCompileShader(s)
    val ok = IntArray(1)
    GLES20.glGetShaderiv(s, GLES20.GL_COMPILE_STATUS, ok, 0)
    if (ok[0] == 0) {
      val log = GLES20.glGetShaderInfoLog(s)
      GLES20.glDeleteShader(s)
      throw GlException("Compile failed: $log")
    }
    return s
  }

  fun texture2d(width: Int, height: Int, rgba: ByteBuffer?, linear: Boolean = true): Int {
    val t = IntArray(1)
    GLES20.glGenTextures(1, t, 0)
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, t[0])
    val filter = if (linear) GLES20.GL_LINEAR else GLES20.GL_NEAREST
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, filter)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, filter)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
    GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, width, height, 0, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, rgba)
    return t[0]
  }

  /** Texture + framebuffer to render into. Returns (texture, framebuffer). */
  fun framebuffer(width: Int, height: Int): Pair<Int, Int> {
    val tex = texture2d(width, height, null)
    val fb = IntArray(1)
    GLES20.glGenFramebuffers(1, fb, 0)
    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fb[0])
    GLES20.glFramebufferTexture2D(GLES20.GL_FRAMEBUFFER, GLES20.GL_COLOR_ATTACHMENT0, GLES20.GL_TEXTURE_2D, tex, 0)
    val status = GLES20.glCheckFramebufferStatus(GLES20.GL_FRAMEBUFFER)
    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
    if (status != GLES20.GL_FRAMEBUFFER_COMPLETE) throw GlException("Framebuffer incomplete: $status")
    return tex to fb[0]
  }

  fun drawQuad(program: Int) {
    QUAD.position(0)
    GLES20.glVertexAttribPointer(0, 2, GLES20.GL_FLOAT, false, 16, QUAD)
    GLES20.glEnableVertexAttribArray(0)
    QUAD.position(2)
    GLES20.glVertexAttribPointer(1, 2, GLES20.GL_FLOAT, false, 16, QUAD)
    GLES20.glEnableVertexAttribArray(1)
    GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
  }

  /** GLSL helper: sample a 33³ LUT stored as a 2D strip (see LookLut.bakeStrip). */
  const val LUT_GLSL = """
    vec3 lookup(sampler2D lut, vec3 c) {
      float n = 33.0;
      c = clamp(c, 0.0, 1.0);
      float b = c.b * (n - 1.0);
      float b0 = floor(b);
      float b1 = min(b0 + 1.0, n - 1.0);
      float x = c.r * (n - 1.0) + 0.5;
      float y = (c.g * (n - 1.0) + 0.5) / n;
      vec3 s0 = texture2D(lut, vec2((b0 * n + x) / (n * n), y)).rgb;
      vec3 s1 = texture2D(lut, vec2((b1 * n + x) / (n * n), y)).rgb;
      return mix(s0, s1, b - b0);
    }
  """
}
