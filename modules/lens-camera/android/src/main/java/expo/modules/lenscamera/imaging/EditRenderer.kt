package expo.modules.lenscamera.imaging

import android.opengl.GLES20
import expo.modules.lenscamera.gl.GlUtil
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.pow
import kotlin.random.Random

/**
 * Applies an [EditRecipe] on the GPU (OpenGL ES 2.0), in the same order as
 * ios/Imaging/ImagePipeline.swift: auto → (portrait) → exposure →
 * highlights/shadows → warmth/tint → contrast/saturation → vibrance → look →
 * sharpness → vignette → grain, with the crop/rotation as a coordinate mapping.
 *
 * Renders one output tile at a time from a texture holding a region of the
 * stored image, so any photo size works within a GPU's texture limit.
 * Must be used on the thread that owns the GL context.
 */
class EditRenderer {
  private val program = GlUtil.program(VERTEX, FRAGMENT)
  private val noiseTexture: Int

  init {
    // Film grain: a fixed random tile, so grain is identical in the editor and the export.
    val random = Random(7)
    val noise = ByteBuffer.allocateDirect(NOISE * NOISE * 4).order(ByteOrder.nativeOrder())
    repeat(NOISE * NOISE) {
      val v = random.nextInt(256).toByte()
      noise.put(v).put(v).put(v).put(-1)
    }
    noise.position(0)
    noiseTexture = GlUtil.texture2d(NOISE, NOISE, noise, linear = false)
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, noiseTexture)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_REPEAT)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_REPEAT)
  }

  class Inputs(
    val source: Int,
    /** Stored-image region (0…1) the source texture holds: x, y, w, h. */
    val region: FloatArray,
    val sourceWidth: Int,
    val sourceHeight: Int,
    /** Blurred luminance of the whole stored image (texture), or 0. */
    val base: Int,
    /** Subject mask of the whole stored image for Portrait blur (texture), or 0. */
    val mask: Int = 0,
    val lut: Int,
    val geometry: DoubleArray,
    val outputWidth: Int,
    val outputHeight: Int,
  )

  /**
   * Draws the output rectangle (tileX, tileY, tileW, tileH) in output pixels
   * into the current viewport. [flipY]: true when drawing to a window (origin
   * bottom-left) instead of a framebuffer that is read back top row first.
   */
  fun draw(recipe: EditRecipe?, auto: Tone.Auto, inputs: Inputs, tileX: Int, tileY: Int, tileW: Int, tileH: Int, flipY: Boolean = false) {
    val r = recipe ?: EditRecipe()
    val p = program
    GLES20.glUseProgram(p)
    fun u(name: String) = GLES20.glGetUniformLocation(p, name)

    GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, inputs.source)
    GLES20.glUniform1i(u("uSrc"), 0)
    GLES20.glActiveTexture(GLES20.GL_TEXTURE1)
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, inputs.base)
    GLES20.glUniform1i(u("uBase"), 1)
    GLES20.glActiveTexture(GLES20.GL_TEXTURE2)
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, inputs.lut)
    GLES20.glUniform1i(u("uLut"), 2)
    GLES20.glActiveTexture(GLES20.GL_TEXTURE3)
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, noiseTexture)
    GLES20.glUniform1i(u("uNoise"), 3)
    GLES20.glActiveTexture(GLES20.GL_TEXTURE4)
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, inputs.mask)
    GLES20.glUniform1i(u("uMask"), 4)

    val g = inputs.geometry
    GLES20.glUniform3f(u("uGeoX"), g[0].toFloat(), g[1].toFloat(), g[2].toFloat())
    GLES20.glUniform3f(u("uGeoY"), g[3].toFloat(), g[4].toFloat(), g[5].toFloat())
    GLES20.glUniform4fv(u("uRegion"), 1, inputs.region, 0)
    GLES20.glUniform2f(u("uTileOrigin"), tileX.toFloat(), tileY.toFloat())
    GLES20.glUniform2f(u("uTileSize"), tileW.toFloat(), tileH.toFloat())
    GLES20.glUniform2f(u("uOutSize"), inputs.outputWidth.toFloat(), inputs.outputHeight.toFloat())
    GLES20.glUniform1f(u("uFlip"), if (flipY) 1f else 0f)
    // Grain coordinates stay small (mediump-safe): tile offset folded into 0…1.
    GLES20.glUniform2f(u("uNoiseOffset"), (tileX % NOISE) / NOISE.toFloat(), (tileY % NOISE) / NOISE.toFloat())
    GLES20.glUniform2f(u("uNoiseScale"), tileW / NOISE.toFloat(), tileH / NOISE.toFloat())
    GLES20.glUniform2f(u("uTexel"), 1f / inputs.sourceWidth, 1f / inputs.sourceHeight)

    val a = if (r.auto) auto else Tone.Auto.NEUTRAL
    GLES20.glUniform4f(u("uAuto"), a.black.toFloat(), a.white.toFloat(), a.gamma.toFloat(), a.vibrance.toFloat())
    GLES20.glUniform1f(u("uExposure"), 2.0.pow(r.exposure).toFloat())
    GLES20.glUniform2f(u("uHS"), r.highlights.toFloat(), r.shadows.toFloat())
    // Without a base layer (video frames), each pixel's own brightness is used.
    GLES20.glUniform1f(u("uHasBase"), if (inputs.base != 0) 1f else 0f)
    GLES20.glUniform2f(u("uWT"), r.warmth.toFloat(), r.tint.toFloat())
    GLES20.glUniform3f(u("uCSV"), r.contrast.toFloat(), r.saturation.toFloat(), r.vibrance.toFloat())
    GLES20.glUniform3f(u("uFx"), r.sharpness.toFloat(), r.vignette.toFloat(), r.grain.toFloat())
    GLES20.glUniform1f(u("uLutMix"), if (r.look != null && inputs.lut != 0) r.intensity.toFloat().coerceIn(0f, 1f) else 0f)
    // Portrait: f/1.4 = strongest blur … f/16 = none (same mapping as iOS).
    val blur = r.aperture?.let { ((1 - (it - 1.4) / 14.6) * 22).coerceIn(0.0, 22.0) } ?: 0.0
    GLES20.glUniform1f(u("uBlur"), if (inputs.mask != 0) blur.toFloat() else 0f)
    GLES20.glUniform1f(u("uAspect"), inputs.outputWidth.toFloat() / inputs.outputHeight)
    GlUtil.drawQuad(p)
  }

  fun release() {
    GLES20.glDeleteProgram(program)
    GLES20.glDeleteTextures(1, intArrayOf(noiseTexture), 0)
  }

  companion object {
    const val NOISE = 256

    private const val VERTEX = """
      attribute vec2 aPos;
      attribute vec2 aUv;
      uniform vec2 uTileOrigin;
      uniform vec2 uTileSize;
      uniform vec2 uOutSize;
      uniform vec3 uGeoX;
      uniform vec3 uGeoY;
      uniform vec4 uRegion;
      uniform float uFlip;
      uniform vec2 uNoiseOffset;
      uniform vec2 uNoiseScale;
      varying vec2 vTex;
      varying vec2 vSrc;
      varying vec2 vOut;
      varying vec2 vNoise;
      void main() {
        gl_Position = vec4(aPos, 0.0, 1.0);
        vec2 uv = vec2(aUv.x, uFlip > 0.5 ? 1.0 - aUv.y : aUv.y);
        vec2 o = (uTileOrigin + uv * uTileSize) / uOutSize;
        vOut = o;
        vec2 s = vec2(dot(uGeoX, vec3(o, 1.0)), dot(uGeoY, vec3(o, 1.0)));
        vSrc = s;
        vTex = (s - uRegion.xy) / uRegion.zw;
        vNoise = uNoiseOffset + uv * uNoiseScale;
      }
    """

    private const val FRAGMENT = """
      #ifdef GL_FRAGMENT_PRECISION_HIGH
      precision highp float;
      #else
      precision mediump float;
      #endif
      varying vec2 vTex;
      varying vec2 vSrc;
      varying vec2 vOut;
      varying vec2 vNoise;
      uniform sampler2D uSrc;
      uniform sampler2D uBase;
      uniform sampler2D uLut;
      uniform sampler2D uNoise;
      uniform sampler2D uMask;
      uniform vec2 uTexel;
      uniform vec4 uAuto;
      uniform float uExposure;
      uniform vec2 uHS;
      uniform vec2 uWT;
      uniform vec3 uCSV;
      uniform vec3 uFx;
      uniform float uLutMix;
      uniform float uBlur;
      uniform float uAspect;
      uniform float uHasBase;
      ${GlUtil.LUT_GLSL}
      float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
      vec3 vibrance(vec3 c, float amount) {
        float mx = max(c.r, max(c.g, c.b));
        float mn = min(c.r, min(c.g, c.b));
        float l = luma(c);
        return mix(vec3(l), c, 1.0 + amount * (1.0 - (mx - mn)) * 1.5);
      }
      vec3 source(vec2 t) {
        vec3 c = texture2D(uSrc, t).rgb;
        if (uBlur > 0.0) {
          // Portrait: blur the background, keep the subject (mask = 1) sharp.
          float subject = texture2D(uMask, vSrc).r;
          float radius = uBlur * (1.0 - subject);
          if (radius > 0.3) {
            vec3 acc = c;
            float n = 1.0;
            for (int i = 0; i < 12; i++) {
              float a = float(i) * 0.5236;
              vec2 d = vec2(cos(a), sin(a)) * uTexel * radius * 1.6;
              acc += texture2D(uSrc, t + d).rgb + texture2D(uSrc, t + d * 0.5).rgb;
              n += 2.0;
            }
            c = acc / n;
          }
        }
        return c;
      }
      void main() {
        vec3 c = source(vTex);
        vec3 detail = vec3(0.0);
        if (uFx.x > 0.0) {
          vec3 around = texture2D(uSrc, vTex + vec2(uTexel.x, 0.0)).rgb + texture2D(uSrc, vTex - vec2(uTexel.x, 0.0)).rgb
            + texture2D(uSrc, vTex + vec2(0.0, uTexel.y)).rgb + texture2D(uSrc, vTex - vec2(0.0, uTexel.y)).rgb;
          detail = c - around * 0.25;
        }
        // Auto: levels + mid-tone gamma + a touch of vibrance.
        c = clamp((c - uAuto.x) / max(uAuto.y - uAuto.x, 0.01), 0.0, 1.0);
        c = pow(c, vec3(uAuto.z));
        c = vibrance(c, uAuto.w);
        // Exposure and local tone in linear light.
        vec3 lin = pow(c, vec3(2.2)) * uExposure;
        float b = uHasBase > 0.5 ? texture2D(uBase, vSrc).r : luma(c);
        lin *= 1.0 + uHS.y * 1.2 * (1.0 - smoothstep(0.05, 0.6, b));
        lin *= 1.0 + uHS.x * 0.6 * smoothstep(0.4, 0.95, b);
        lin *= vec3(1.0 + 0.12 * uWT.x + 0.04 * uWT.y, 1.0 - 0.08 * uWT.y, 1.0 - 0.12 * uWT.x + 0.04 * uWT.y);
        c = pow(clamp(lin, 0.0, 1.0), vec3(1.0 / 2.2));
        // Contrast / saturation / vibrance.
        c = mix(vec3(luma(c)), c, max(0.0, 1.0 + uCSV.y));
        c = (c - 0.5) * (1.0 + 0.5 * uCSV.x) + 0.5;
        c = vibrance(clamp(c, 0.0, 1.0), uCSV.z);
        if (uLutMix > 0.0) c = mix(c, lookup(uLut, c), uLutMix);
        c += detail * uFx.x * 1.2;
        if (uFx.y > 0.0) {
          vec2 d = (vOut - 0.5) * vec2(uAspect, 1.0) / max(uAspect, 1.0) * 2.0;
          c *= 1.0 - uFx.y * 1.0 * smoothstep(0.45, 1.35, length(d));
        }
        if (uFx.z > 0.0) {
          float n = texture2D(uNoise, vNoise).r - 0.5;
          c += n * uFx.z * 0.16 * (0.4 + 2.4 * luma(c) * (1.0 - luma(c)));
        }
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }
    """
  }
}
