import AVFoundation
import ExpoModulesCore

struct PhotoOptions: Record {
  @Field var raw: Bool = false
  @Field var flash: String = "off"
}

struct AnalysisProps: Record {
  @Field var peaking: Bool = false
  @Field var zebra: Bool = false
  @Field var zebraLevel: Double = 0.95
  @Field var falseColor: Bool = false
  @Field var histogram: Bool = true
}

public class LensCameraModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LensCamera")

    View(LensCameraView.self) {
      Events("onReady", "onStats", "onAnalysis", "onError")

      OnViewDidUpdateProps { (view: LensCameraView) in
        view.applyProps()
      }

      Prop("active") { (view: LensCameraView, value: Bool) in
        view.active = value
      }
      Prop("position") { (view: LensCameraView, value: String) in
        view.config.position = value == "front" ? .front : .back
      }
      Prop("lens") { (view: LensCameraView, value: String) in
        view.config.lens = value
      }
      Prop("mode") { (view: LensCameraView, value: String) in
        view.config.mode = value
      }
      Prop("videoResolution") { (view: LensCameraView, value: String) in
        view.config.videoResolution = value
      }
      Prop("appleLog") { (view: LensCameraView, value: Bool) in
        view.config.appleLog = value
      }
      Prop("hdrVideo") { (view: LensCameraView, value: Bool) in
        view.config.hdrVideo = value
      }
      Prop("fps") { (view: LensCameraView, value: Int) in
        view.config.fps = value
      }
      Prop("stabilization") { (view: LensCameraView, value: String) in
        view.config.stabilization = value
      }
      Prop("look") { (view: LensCameraView, value: String?) in
        view.look = value
      }
      Prop("lookIntensity") { (view: LensCameraView, value: Double) in
        view.lookIntensity = value
      }
      Prop("torch") { (view: LensCameraView, value: Bool) in
        view.config.torch = value
      }
      Prop("zoom") { (view: LensCameraView, value: Double) in
        view.config.zoom = value
      }
      Prop("exposureMode") { (view: LensCameraView, value: String) in
        view.config.exposureMode = value
      }
      Prop("iso") { (view: LensCameraView, value: Double) in
        view.config.iso = value
      }
      Prop("shutter") { (view: LensCameraView, value: Double) in
        view.config.shutter = value
      }
      Prop("ev") { (view: LensCameraView, value: Double) in
        view.config.ev = value
      }
      Prop("whiteBalanceMode") { (view: LensCameraView, value: String) in
        view.config.whiteBalanceMode = value
      }
      Prop("temperature") { (view: LensCameraView, value: Double) in
        view.config.temperature = value
      }
      Prop("tint") { (view: LensCameraView, value: Double) in
        view.config.tint = value
      }
      Prop("focusMode") { (view: LensCameraView, value: String) in
        view.config.focusMode = value
      }
      Prop("lensPosition") { (view: LensCameraView, value: Double) in
        view.config.lensPosition = value
      }
      Prop("analysis") { (view: LensCameraView, value: AnalysisProps) in
        view.analysis = AnalysisOptions(
          peaking: value.peaking,
          zebra: value.zebra,
          zebraLevel: value.zebraLevel,
          falseColor: value.falseColor,
          histogram: value.histogram
        )
      }

      AsyncFunction("takePhoto") { (view: LensCameraView, options: PhotoOptions, promise: Promise) in
        view.takePhoto(raw: options.raw, flash: options.flash, promise: promise)
      }.runOnQueue(.main)

      AsyncFunction("takeNightPhoto") { (view: LensCameraView, frames: Int, promise: Promise) in
        view.takeNightPhoto(frames: frames, promise: promise)
      }.runOnQueue(.main)

      AsyncFunction("startRecording") { (view: LensCameraView, promise: Promise) in
        view.startRecording(promise: promise)
      }.runOnQueue(.main)

      AsyncFunction("stopRecording") { (view: LensCameraView) in
        view.stopRecording()
      }.runOnQueue(.main)

      AsyncFunction("focusAt") { (view: LensCameraView, x: Double, y: Double) in
        view.focus(x: x, y: y)
      }.runOnQueue(.main)
    }
  }
}
