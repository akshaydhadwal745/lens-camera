package expo.modules.lenscamera.imaging

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.util.Size
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BaseGlShaderProgram
import androidx.media3.effect.GlEffect
import androidx.media3.effect.GlShaderProgram
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import expo.modules.lenscamera.LookLut
import expo.modules.lenscamera.LookStore
import expo.modules.lenscamera.gl.GlUtil
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID

/**
 * Renders a video with a look/adjustments (not crop) into a new file, with
 * Media3 Transformer (hardware decode → our GPU shader → hardware encode;
 * audio is copied). Runs only on demand (share/save, or "bake" after
 * recording) because it re-encodes every frame; the original is never touched.
 */
@OptIn(UnstableApi::class)
object VideoExport {
  fun export(context: Context, uri: String, recipe: EditRecipe?, done: (Result<File>) -> Unit) {
    val input = ImagingEngine.fileOf(uri)
    val output = File(context.cacheDir, "lens-export-${UUID.randomUUID()}.mp4")
    val colour = recipe?.colourOnly()
    Handler(Looper.getMainLooper()).post {
      try {
        val item = EditedMediaItem.Builder(MediaItem.fromUri(android.net.Uri.fromFile(input)))
          .setEffects(Effects(emptyList(), if (colour != null) listOf(RecipeEffect(context.applicationContext, colour)) else emptyList()))
          .build()
        // Looks are defined for normal (SDR) video: HDR recordings are tone-mapped first.
        val composition = Composition.Builder(EditedMediaItemSequence.withAudioAndVideoFrom(listOf(item)))
          .setHdrMode(Composition.HDR_MODE_TONE_MAP_HDR_TO_SDR_USING_OPEN_GL)
          .build()
        val transformer = Transformer.Builder(context)
          .addListener(object : Transformer.Listener {
            override fun onCompleted(composition: Composition, exportResult: ExportResult) {
              done(Result.success(output))
            }

            override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
              output.delete()
              done(Result.failure(ImagingException(exportException.message ?: "Video export failed")))
            }
          })
          .build()
        transformer.start(composition, output.path)
      } catch (e: Exception) {
        done(Result.failure(e))
      }
    }
  }

  private class RecipeEffect(private val appContext: Context, private val recipe: EditRecipe) : GlEffect {
    override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram = Program(appContext, recipe, useHdr)
  }

  /** Our edit shader as a Media3 frame processor (runs in Media3's GL context). */
  private class Program(private val context: Context, private val recipe: EditRecipe, useHdr: Boolean) :
    BaseGlShaderProgram(useHdr, 1) {
    private var renderer: EditRenderer? = null
    private var lut = 0
    private var width = 1
    private var height = 1
    // A mild, fixed "auto" for video (per-frame auto would flicker).
    private val auto = Tone.Auto(0.02, 0.98, 0.95, 0.15)

    override fun configure(inputWidth: Int, inputHeight: Int): Size {
      width = inputWidth
      height = inputHeight
      return Size(inputWidth, inputHeight)
    }

    override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
      val r = renderer ?: EditRenderer().also { renderer = it }
      if (lut == 0 && recipe.look != null) {
        LookStore.strip(context, recipe.look)?.let { strip ->
          val n = LookLut.SIZE
          val buffer = ByteBuffer.allocateDirect(strip.size).order(ByteOrder.nativeOrder()).put(strip)
          buffer.position(0)
          lut = GlUtil.texture2d(n * n, n, buffer)
        }
      }
      val inputs = EditRenderer.Inputs(
        source = inputTexId,
        region = floatArrayOf(0f, 0f, 1f, 1f),
        sourceWidth = width,
        sourceHeight = height,
        base = 0,
        lut = lut,
        geometry = Geometry.IDENTITY.values,
        outputWidth = width,
        outputHeight = height,
      )
      r.draw(recipe, auto, inputs, 0, 0, width, height)
    }

    override fun release() {
      super.release()
      renderer?.release()
      if (lut != 0) android.opengl.GLES20.glDeleteTextures(1, intArrayOf(lut), 0)
    }
  }
}
