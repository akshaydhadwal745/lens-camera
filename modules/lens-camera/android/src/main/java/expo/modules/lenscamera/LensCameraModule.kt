package expo.modules.lenscamera

import androidx.camera.extensions.ExtensionsManager
import androidx.camera.lifecycle.ProcessCameraProvider
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import androidx.core.content.ContextCompat

class PhotoOptions : Record {
  @Field var raw: Boolean = false
  @Field var flash: String = "off"
}

class AnalysisProps : Record {
  @Field var peaking: Boolean = false
  @Field var zebra: Boolean = false
  @Field var zebraLevel: Double = 0.95
  @Field var falseColor: Boolean = false
  @Field var histogram: Boolean = true
}

class LensCameraModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LensCamera")

    // Everything we know about this phone's cameras, for the "Camera info" screen.
    AsyncFunction("deviceReport") { promise: Promise ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val future = ProcessCameraProvider.getInstance(context)
      val main = ContextCompat.getMainExecutor(context)
      future.addListener({
        try {
          val provider = future.get()
          // With the maker's extensions (if the phone has any): which ones exist.
          val ext = ExtensionsManager.getInstanceAsync(context, provider)
          ext.addListener({
            try {
              promise.resolve(DeviceProfile(context, provider).report(runCatching { ext.get() }.getOrNull()))
            } catch (e: Exception) {
              promise.reject("ERR_CAMERA_INFO", e.message, e)
            }
          }, main)
        } catch (e: Exception) {
          promise.reject("ERR_CAMERA_INFO", e.message, e)
        }
      }, main)
    }

    View(LensCameraView::class) {
      Events("onReady", "onStats", "onAnalysis", "onError", "onDiagnostics")

      OnViewDidUpdateProps { view: LensCameraView -> view.applyProps() }
      OnViewDestroys { view: LensCameraView -> view.destroy() }

      Prop("active") { view: LensCameraView, value: Boolean -> view.active = value }
      Prop("facing") { view: LensCameraView, value: String -> view.config = view.config.copy(position = value) }
      Prop("lens") { view: LensCameraView, value: String -> view.config = view.config.copy(lens = value) }
      Prop("mode") { view: LensCameraView, value: String -> view.config = view.config.copy(mode = value) }
      Prop("videoResolution") { view: LensCameraView, value: String -> view.config = view.config.copy(videoResolution = value) }
      Prop("appleLog") { _: LensCameraView, _: Boolean -> }
      Prop("hdrVideo") { view: LensCameraView, value: Boolean -> view.config = view.config.copy(hdrVideo = value) }
      Prop("fps") { view: LensCameraView, value: Int -> view.config = view.config.copy(fps = value) }
      Prop("stabilization") { view: LensCameraView, value: String -> view.config = view.config.copy(stabilization = value) }
      Prop("look") { view: LensCameraView, value: String? -> view.look = value }
      Prop("lookIntensity") { view: LensCameraView, value: Double -> view.lookIntensity = value }
      Prop("torch") { view: LensCameraView, value: Boolean -> view.config = view.config.copy(torch = value) }
      Prop("zoom") { view: LensCameraView, value: Double -> view.config = view.config.copy(zoom = value) }
      Prop("exposureMode") { view: LensCameraView, value: String -> view.config = view.config.copy(exposureMode = value) }
      Prop("iso") { view: LensCameraView, value: Double -> view.config = view.config.copy(iso = value) }
      Prop("shutter") { view: LensCameraView, value: Double -> view.config = view.config.copy(shutter = value) }
      Prop("ev") { view: LensCameraView, value: Double -> view.config = view.config.copy(ev = value) }
      Prop("whiteBalanceMode") { view: LensCameraView, value: String -> view.config = view.config.copy(whiteBalanceMode = value) }
      Prop("temperature") { view: LensCameraView, value: Double -> view.config = view.config.copy(temperature = value) }
      Prop("tint") { view: LensCameraView, value: Double -> view.config = view.config.copy(tint = value) }
      Prop("focusMode") { view: LensCameraView, value: String -> view.config = view.config.copy(focusMode = value) }
      Prop("lensPosition") { view: LensCameraView, value: Double -> view.config = view.config.copy(lensPosition = value) }
      Prop("raw") { view: LensCameraView, value: Boolean -> view.config = view.config.copy(raw = value) }
      Prop("hdrPhoto") { view: LensCameraView, value: Boolean -> view.config = view.config.copy(hdrPhoto = value) }
      Prop("extension") { view: LensCameraView, value: String -> view.config = view.config.copy(extension = value) }
      Prop("captureMode") { view: LensCameraView, value: String -> view.config = view.config.copy(captureMode = value) }
      Prop("analysis") { view: LensCameraView, value: AnalysisProps ->
        view.analysis = AnalysisOptions(value.peaking, value.zebra, value.zebraLevel, value.falseColor, value.histogram)
      }

      AsyncFunction("takePhoto") { view: LensCameraView, options: PhotoOptions, promise: Promise ->
        view.takePhoto(options.flash, promise)
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("takeNightPhoto") { view: LensCameraView, frames: Int, promise: Promise ->
        view.takeNightPhoto(frames, promise)
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("takeBurst") { view: LensCameraView, frames: Int, promise: Promise ->
        view.takeBurst(frames, promise)
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("thermalStatus") { view: LensCameraView ->
        view.thermalStatus()
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("startRecording") { view: LensCameraView, promise: Promise ->
        view.startRecording(promise)
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("stopRecording") { view: LensCameraView ->
        view.stopRecording()
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("focusAt") { view: LensCameraView, x: Double, y: Double ->
        view.focus(x, y)
      }.runOnQueue(Queues.MAIN)
    }
  }
}
