import CoreImage
import ExpoModulesCore
import UIKit

/// Live editor preview: shows `uri` with `recipe` applied, re-rendering on the
/// GPU at screen resolution whenever the recipe changes (slider drags).
final class LensEditView: ExpoView {
  let onRenderError = EventDispatcher()

  var uri: String? {
    didSet { if uri != oldValue { loadSource() } }
  }
  var recipe: EditRecipe?
  var showOriginal = false

  private let imageView = UIImageView()
  private let queue = DispatchQueue(label: "lens.edit.render", qos: .userInitiated)
  private var source: CIImage?
  private var disparity: CIImage?
  private var rendering = false
  private var needsRender = false
  private let maxPixel: CGFloat = 1800

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    imageView.contentMode = .scaleAspectFit
    addSubview(imageView)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    imageView.frame = bounds
  }

  func propsChanged() {
    scheduleRender()
  }

  private func loadSource() {
    guard let uri, let url = imagingURL(uri) else { return }
    let pipeline = ImagePipeline.shared
    let limit = maxPixel
    queue.async { [weak self] in
      let image = pipeline.load(url).map { pipeline.fit($0, maxPixel: limit) }
      let depth = pipeline.loadDisparity(url)
      DispatchQueue.main.async {
        guard let self else { return }
        if image == nil { self.onRenderError(["message": "Could not open this photo"]) }
        self.source = image
        self.disparity = depth
        self.scheduleRender()
      }
    }
  }

  /// Coalesces rapid recipe changes: at most one render in flight, plus one queued.
  private func scheduleRender() {
    guard source != nil else { return }
    if rendering {
      needsRender = true
      return
    }
    rendering = true
    let image = source!
    let depth = disparity
    let current = showOriginal ? nil : recipe
    let pipeline = ImagePipeline.shared
    queue.async { [weak self] in
      let output = pipeline.apply(current, to: image, disparity: depth)
      let cg = pipeline.context.createCGImage(output, from: output.extent)
      DispatchQueue.main.async {
        guard let self else { return }
        if let cg { self.imageView.image = UIImage(cgImage: cg) }
        self.rendering = false
        if self.needsRender {
          self.needsRender = false
          self.scheduleRender()
        }
      }
    }
  }
}

/// Accepts "file:///…" URIs and bare paths.
func imagingURL(_ uri: String) -> URL? {
  if uri.hasPrefix("file://") { return URL(string: uri) }
  if uri.hasPrefix("/") { return URL(fileURLWithPath: uri) }
  return URL(string: uri)
}
