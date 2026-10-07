import AVFoundation
import CoreImage

/// Renders a video with a look/adjustments (not crop) into a new HEVC file.
/// Runs only on demand (share/save, or "bake" after recording) because it
/// re-encodes every frame; the original video is never modified.
enum VideoExporter {
  static func export(url: URL, recipe: EditRecipe?, completion: @escaping (Result<URL, Error>) -> Void) {
    let asset = AVURLAsset(url: url)
    // Crop/portrait don't apply to video; looks + adjustments do.
    var videoRecipe = recipe
    videoRecipe?.crop = nil
    videoRecipe?.portrait = nil
    let finalRecipe = videoRecipe
    let pipeline = ImagePipeline.shared

    let composition = AVMutableVideoComposition(asset: asset) { request in
      let source = request.sourceImage
      let output = pipeline.apply(finalRecipe, to: source).cropped(to: request.sourceImage.extent)
      request.finish(with: output, context: pipeline.context)
    }

    let preset = AVAssetExportSession.allExportPresets().contains(AVAssetExportPresetHEVCHighestQuality)
      ? AVAssetExportPresetHEVCHighestQuality
      : AVAssetExportPresetHighestQuality
    guard let session = AVAssetExportSession(asset: asset, presetName: preset) else {
      completion(.failure(ImagingError.message("Video export is not available")))
      return
    }
    let target = FileManager.default.temporaryDirectory.appendingPathComponent("lens-export-\(UUID().uuidString).mov")
    session.outputURL = target
    session.outputFileType = .mov
    session.videoComposition = composition
    session.shouldOptimizeForNetworkUse = true
    session.exportAsynchronously {
      switch session.status {
      case .completed:
        completion(.success(target))
      default:
        completion(.failure(session.error ?? ImagingError.message("Video export failed")))
      }
    }
  }
}
