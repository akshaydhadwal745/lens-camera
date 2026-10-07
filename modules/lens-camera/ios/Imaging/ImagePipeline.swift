import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers

enum ImagingError: LocalizedError {
  case message(String)
  var errorDescription: String? {
    switch self {
    case .message(let m): return m
    }
  }
}

/// Applies `EditRecipe`s with Core Image (GPU). Shared by the editor view,
/// preview/thumbnail rendering, "bake" at capture, and exports.
final class ImagePipeline {
  static let shared = ImagePipeline()

  let context: CIContext = {
    let workingSpace = CGColorSpace(name: CGColorSpace.extendedLinearDisplayP3) ?? CGColorSpaceCreateDeviceRGB()
    return CIContext(options: [.workingColorSpace: workingSpace, .cacheIntermediates: false])
  }()

  private let outputSpace = CGColorSpace(name: CGColorSpace.displayP3) ?? CGColorSpaceCreateDeviceRGB()

  // MARK: Loading

  /// Loads an image upright (EXIF orientation applied). HEIC, JPEG, PNG, DNG.
  func load(_ url: URL) -> CIImage? {
    if url.pathExtension.lowercased() == "dng", let raw = CIRAWFilter(imageURL: url), let image = raw.outputImage {
      return image
    }
    return CIImage(contentsOf: url, options: [.applyOrientationProperty: true])
  }

  /// Disparity (depth) map embedded by Portrait capture, upright, if present.
  func loadDisparity(_ url: URL) -> CIImage? {
    CIImage(contentsOf: url, options: [.auxiliaryDisparity: true, .applyOrientationProperty: true])
  }

  func hasDepth(_ url: URL) -> Bool {
    loadDisparity(url) != nil
  }

  /// Downscales so the longest side is at most `maxPixel` (never upscales).
  func fit(_ image: CIImage, maxPixel: CGFloat) -> CIImage {
    let longest = max(image.extent.width, image.extent.height)
    guard longest > maxPixel, longest > 0 else { return image }
    let scale = maxPixel / longest
    return image.applyingFilter("CILanczosScaleTransform", parameters: [
      kCIInputScaleKey: scale,
      kCIInputAspectRatioKey: 1.0,
    ])
  }

  // MARK: Recipe

  func apply(_ recipe: EditRecipe?, to source: CIImage, disparity: CIImage? = nil) -> CIImage {
    guard let recipe else { return source }
    let extent = source.extent
    var image = source

    if recipe.auto == true {
      for filter in source.autoAdjustmentFilters(options: [.redEye: false]) {
        filter.setValue(image, forKey: kCIInputImageKey)
        if let out = filter.outputImage { image = out }
      }
    }

    // Portrait: depth-based background blur (needs the disparity map).
    if let aperture = recipe.portrait?.aperture, let disparity, let blur = CIFilter(name: "CIDepthBlurEffect") {
      let scaled = disparity.transformed(by: CGAffineTransform(
        scaleX: extent.width / disparity.extent.width,
        y: extent.height / disparity.extent.height
      ))
      blur.setValue(image, forKey: kCIInputImageKey)
      blur.setValue(scaled, forKey: "inputDisparityImage")
      // Map f-number (1.4…16) to the filter's aperture (≈ strong…none).
      let strength = max(0, min(22, 22 * (1 - (aperture - 1.4) / 14.6)))
      blur.setValue(strength, forKey: "inputAperture")
      if let out = blur.outputImage { image = out.cropped(to: extent) }
    }

    let a = recipe.adjust
    if let ev = a?.exposure, ev != 0 {
      image = image.applyingFilter("CIExposureAdjust", parameters: [kCIInputEVKey: ev])
    }
    let highlights = a?.highlights ?? 0
    let shadows = a?.shadows ?? 0
    if highlights != 0 || shadows != 0 {
      image = image.applyingFilter("CIHighlightShadowAdjust", parameters: [
        "inputHighlightAmount": max(0, min(1, 1 + highlights)),
        "inputShadowAmount": max(-1, min(1, shadows)),
      ])
    }
    let warmth = a?.warmth ?? 0
    let tint = a?.tint ?? 0
    if warmth != 0 || tint != 0 {
      image = image.applyingFilter("CIColorMatrix", parameters: [
        "inputRVector": CIVector(x: 1 + 0.12 * warmth + 0.04 * tint, y: 0, z: 0, w: 0),
        "inputGVector": CIVector(x: 0, y: 1 - 0.08 * tint, z: 0, w: 0),
        "inputBVector": CIVector(x: 0, y: 0, z: 1 - 0.12 * warmth + 0.04 * tint, w: 0),
        "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 1),
      ])
    }
    let contrast = a?.contrast ?? 0
    let saturation = a?.saturation ?? 0
    if contrast != 0 || saturation != 0 {
      image = image.applyingFilter("CIColorControls", parameters: [
        kCIInputContrastKey: 1 + 0.5 * contrast,
        kCIInputSaturationKey: max(0, 1 + saturation),
        kCIInputBrightnessKey: 0,
      ])
    }
    if let vibrance = a?.vibrance, vibrance != 0 {
      image = image.applyingFilter("CIVibrance", parameters: ["inputAmount": vibrance])
    }

    if let look = recipe.look {
      image = Looks.apply(look, intensity: recipe.intensity ?? 1, to: image)
    }

    if let sharpness = a?.sharpness, sharpness > 0 {
      image = image.applyingFilter("CISharpenLuminance", parameters: [kCIInputSharpnessKey: 0.8 * sharpness])
    }
    if let vignette = a?.vignette, vignette > 0 {
      image = image.applyingFilter("CIVignette", parameters: [
        kCIInputIntensityKey: 1.2 * vignette,
        kCIInputRadiusKey: 1.5,
      ])
    }
    if let grain = a?.grain, grain > 0 {
      image = addGrain(image, amount: grain)
    }

    image = image.cropped(to: extent)
    if let crop = recipe.crop {
      image = applyCrop(crop, to: image)
    }
    return image
  }

  private func addGrain(_ image: CIImage, amount: Double) -> CIImage {
    guard let noise = CIFilter(name: "CIRandomGenerator")?.outputImage else { return image }
    let strength = 0.12 * amount
    let mono = noise
      .applyingFilter("CIColorMatrix", parameters: [
        "inputRVector": CIVector(x: 0, y: 1, z: 0, w: 0),
        "inputGVector": CIVector(x: 0, y: 1, z: 0, w: 0),
        "inputBVector": CIVector(x: 0, y: 1, z: 0, w: 0),
        "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 0),
        "inputBiasVector": CIVector(x: 0, y: 0, z: 0, w: strength),
      ])
      .cropped(to: image.extent)
    return mono.applyingFilter("CISoftLightBlendMode", parameters: [kCIInputBackgroundImageKey: image])
  }

  /// Quarter turns, mirror, straighten (with auto-crop to the largest upright
  /// rectangle) and a normalised crop rect.
  func applyCrop(_ crop: EditRecipe.Crop, to input: CIImage) -> CIImage {
    var image = input
    switch ((crop.rotate ?? 0) % 4 + 4) % 4 {
    case 1: image = image.oriented(.right)
    case 2: image = image.oriented(.down)
    case 3: image = image.oriented(.left)
    default: break
    }
    if crop.flip == true {
      image = image.oriented(.upMirrored)
    }
    image = image.transformed(by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY))

    if let degrees = crop.straighten, abs(degrees) > 0.01 {
      let w = image.extent.width
      let h = image.extent.height
      let theta = CGFloat(abs(degrees)) * .pi / 180
      let scale = min(w / (w * cos(theta) + h * sin(theta)), h / (w * sin(theta) + h * cos(theta)))
      let center = CGPoint(x: w / 2, y: h / 2)
      let rotation = CGAffineTransform(translationX: center.x, y: center.y)
        .rotated(by: -CGFloat(degrees) * .pi / 180)
        .translatedBy(x: -center.x, y: -center.y)
      let inner = CGRect(x: center.x - w * scale / 2, y: center.y - h * scale / 2, width: w * scale, height: h * scale)
      image = image.clampedToExtent().transformed(by: rotation).cropped(to: inner)
      image = image.transformed(by: CGAffineTransform(translationX: -inner.minX, y: -inner.minY))
    }

    if let x = crop.x, let y = crop.y, let cw = crop.w, let ch = crop.h, cw > 0, ch > 0, cw < 1 || ch < 1 || x > 0 || y > 0 {
      let W = image.extent.width
      let H = image.extent.height
      // Recipe rects are top-left based; Core Image is bottom-left based.
      let rect = CGRect(x: x * W, y: (1 - y - ch) * H, width: cw * W, height: ch * H).integral
      image = image.cropped(to: rect)
      image = image.transformed(by: CGAffineTransform(translationX: -rect.minX, y: -rect.minY))
    }
    return image
  }

  // MARK: Rendering

  /// Renders `url` with `recipe` to a new file. `format`: "heic" | "jpeg".
  func render(url: URL, recipe: EditRecipe?, maxPixel: CGFloat?, format: String, quality: Double) throws -> (url: URL, width: Int, height: Int) {
    guard var image = load(url) else { throw ImagingError.message("Could not read the image") }
    let disparity = recipe?.portrait != nil ? loadDisparity(url) : nil
    if let maxPixel {
      // Downscale first for previews: far less GPU work, same look.
      image = fit(image, maxPixel: maxPixel * 1.2)
    }
    var output = apply(recipe, to: image, disparity: disparity)
    if let maxPixel { output = fit(output, maxPixel: maxPixel) }
    output = output.transformed(by: CGAffineTransform(translationX: -output.extent.minX, y: -output.extent.minY))

    let ext = format == "heic" ? "heic" : "jpg"
    let target = FileManager.default.temporaryDirectory.appendingPathComponent("lens-render-\(UUID().uuidString).\(ext)")
    let options: [CIImageRepresentationOption: Any] = [
      CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): quality,
    ]
    let data: Data?
    if format == "heic" {
      data = context.heifRepresentation(of: output, format: .RGBA8, colorSpace: outputSpace, options: options)
    } else {
      data = context.jpegRepresentation(of: output, colorSpace: outputSpace, options: options)
    }
    guard let data else { throw ImagingError.message("Could not encode the image") }
    try data.write(to: target)
    return (target, Int(output.extent.width), Int(output.extent.height))
  }
}
