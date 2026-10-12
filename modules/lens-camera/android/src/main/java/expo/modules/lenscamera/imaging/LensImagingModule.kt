package expo.modules.lenscamera.imaging

import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.sharedobjects.SharedObject
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

    // `player` is expo-video's VideoPlayer (a shared object); we only need its ExoPlayer.
    AsyncFunction("setVideoLook") { player: SharedObject, recipe: Map<String, Any?>? ->
      VideoLook.apply(context, VideoLook.exoPlayerOf(player), EditRecipe.from(recipe))
    }.runOnQueue(Queues.MAIN)

    // Motion photo (checklist 9.2): the clip inside, as its own MP4 in the cache, or null.
    AsyncFunction("motionVideo") { uri: String ->
      val file = ImagingEngine.fileOf(uri)
      val out = java.io.File(context.cacheDir, "motion-${file.name}.mp4")
      if (out.exists() && out.length() > 0) return@AsyncFunction "file://${out.absolutePath}"
      if (runCatching { MotionPhoto.extract(file, out) }.getOrDefault(false)) "file://${out.absolutePath}" else null
    }

    // Document scanning (checklist 9.4): resolves the scanned pages (empty when cancelled).
    AsyncFunction("scanDocument") { promise: Promise ->
      val activity = appContext.currentActivity ?: return@AsyncFunction promise.reject("ERR_SCAN", "No screen to show the scanner on.", null)
      DocumentScan.start(activity) { result ->
        result.fold({ promise.resolve(it) }, { promise.reject("ERR_SCAN", it.message, it) })
      }
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, payload ->
      DocumentScan.onResult(context, payload.requestCode, payload.resultCode, payload.data)
    }

    // Self-test: what a saved photo / video really contains (MediaProbe).
    AsyncFunction("inspectPhoto") { uri: String -> MediaProbe.photo(ImagingEngine.fileOf(uri)) }
    AsyncFunction("mediaInfo") { uri: String -> MediaProbe.video(ImagingEngine.fileOf(uri)) }

    // Self-test: the Play services ML Kit models (present / downloaded / missing).
    AsyncFunction("mlModules") { install: Boolean, timeoutMs: Double -> MlModules.report(context, install, timeoutMs.toLong()) }

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
