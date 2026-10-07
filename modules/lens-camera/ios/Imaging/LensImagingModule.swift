import ExpoModulesCore

struct RenderOptions: Record {
  /// Longest side in pixels; omitted/0 = full resolution.
  @Field var maxPixel: Double = 0
  /// "heic" | "jpeg"
  @Field var format: String = "jpeg"
  @Field var quality: Double = 0.9
}

/// Imaging: render photos with edit recipes, export videos with looks, and the
/// live editor view. All work is on-device (Core Image, GPU).
public class LensImagingModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LensImaging")

    Constant("looks") { Looks.ids }

    AsyncFunction("renderImage") { (uri: String, recipe: [String: Any]?, options: RenderOptions) -> [String: Any] in
      guard let url = imagingURL(uri) else { throw ImagingError.message("Invalid file") }
      let result = try ImagePipeline.shared.render(
        url: url,
        recipe: EditRecipe.from(recipe),
        maxPixel: options.maxPixel > 0 ? CGFloat(options.maxPixel) : nil,
        format: options.format,
        quality: options.quality
      )
      return ["uri": result.url.absoluteString, "width": result.width, "height": result.height]
    }

    AsyncFunction("exportVideo") { (uri: String, recipe: [String: Any]?, promise: Promise) in
      guard let url = imagingURL(uri) else {
        promise.reject("ERR_EXPORT", "Invalid file")
        return
      }
      VideoExporter.export(url: url, recipe: EditRecipe.from(recipe)) { result in
        switch result {
        case .success(let out): promise.resolve(["uri": out.absoluteString])
        case .failure(let error): promise.reject("ERR_EXPORT", error.localizedDescription)
        }
      }
    }

    AsyncFunction("hasDepth") { (uri: String) -> Bool in
      guard let url = imagingURL(uri) else { return false }
      return ImagePipeline.shared.hasDepth(url)
    }

    View(LensEditView.self) {
      Events("onRenderError")

      OnViewDidUpdateProps { (view: LensEditView) in
        view.propsChanged()
      }

      Prop("uri") { (view: LensEditView, value: String) in
        view.uri = value
      }
      Prop("recipe") { (view: LensEditView, value: [String: Any]?) in
        view.recipe = EditRecipe.from(value)
      }
      Prop("showOriginal") { (view: LensEditView, value: Bool) in
        view.showOriginal = value
      }
    }
  }
}
