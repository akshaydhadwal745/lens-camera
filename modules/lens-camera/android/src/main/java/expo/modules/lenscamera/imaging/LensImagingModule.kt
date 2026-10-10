package expo.modules.lenscamera.imaging

import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.lenscamera.LookLut

class RenderOptions : Record {
  /** Longest side in pixels; 0 = full resolution. */
  @Field var maxPixel: Double = 0.0
  /** "heic" | "jpeg". Android writes JPEG (HEIC encoding isn't on every phone). */
  @Field var format: String = "jpeg"
  @Field var quality: Double = 0.9
}

/**
 * Imaging on Android: render photos with edit recipes, export videos with
 * looks, and the live editor view. Same API as the iOS LensImaging module.
 */
class LensImagingModule : Module() {
  private val context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("LensImaging")

    Constant("looks") { LookLut.IDS }

    AsyncFunction("renderImage") { uri: String, recipe: Map<String, Any?>?, options: RenderOptions ->
      val result = ImagingEngine.render(
        context,
        uri,
        EditRecipe.from(recipe),
        if (options.maxPixel > 0) options.maxPixel.toInt() else null,
        options.quality,
      )
      mapOf("uri" to "file://${result.file.absolutePath}", "width" to result.width, "height" to result.height)
    }

    AsyncFunction("exportVideo") { uri: String, recipe: Map<String, Any?>?, promise: Promise ->
      VideoExport.export(context, uri, EditRecipe.from(recipe)) { result ->
        result.fold(
          { promise.resolve(mapOf("uri" to "file://${it.absolutePath}")) },
          { promise.reject("ERR_EXPORT", it.message, it) },
        )
      }
    }

    AsyncFunction("setVideoLook") { player: expo.modules.video.player.VideoPlayer, recipe: Map<String, Any?>? ->
      VideoLook.apply(context, player.player, EditRecipe.from(recipe))
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("hasDepth") { uri: String ->
      runCatching { Portrait.hasMask(ImagingEngine.fileOf(uri)) }.getOrDefault(false)
    }

    View(LensEditView::class) {
      Events("onRenderError")

      OnViewDidUpdateProps { view: LensEditView -> view.propsChanged() }
      OnViewDestroys { view: LensEditView -> view.destroy() }

      Prop("uri") { view: LensEditView, value: String -> view.uri = value }
      Prop("recipe") { view: LensEditView, value: Map<String, Any?>? -> view.recipe = EditRecipe.from(value) }
      Prop("showOriginal") { view: LensEditView, value: Boolean -> view.showOriginal = value }
    }
  }
}
