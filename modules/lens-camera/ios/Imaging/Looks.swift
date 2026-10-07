import CoreImage
import Foundation

/// Creative looks ("filters"). Each look is a pure colour transform, so it can be
/// baked into a 3D LUT for the live viewfinder and applied exactly for stills.
/// Catalog (ids/names) is mirrored in src/lib/edits.ts.
enum Looks {
  static let ids = [
    "natural", "vivid", "warm", "cool", "golden", "cinematic", "film",
    "moody", "fade", "bw", "noir", "vintage", "chrome",
  ]

  private static let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!

  // MARK: Building blocks

  private static func controls(_ image: CIImage, saturation: Double = 1, brightness: Double = 0, contrast: Double = 1) -> CIImage {
    image.applyingFilter("CIColorControls", parameters: [
      kCIInputSaturationKey: saturation,
      kCIInputBrightnessKey: brightness,
      kCIInputContrastKey: contrast,
    ])
  }

  private static func gains(_ image: CIImage, r: CGFloat, g: CGFloat, b: CGFloat, bias: (CGFloat, CGFloat, CGFloat) = (0, 0, 0)) -> CIImage {
    image.applyingFilter("CIColorMatrix", parameters: [
      "inputRVector": CIVector(x: r, y: 0, z: 0, w: 0),
      "inputGVector": CIVector(x: 0, y: g, z: 0, w: 0),
      "inputBVector": CIVector(x: 0, y: 0, z: b, w: 0),
      "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 1),
      "inputBiasVector": CIVector(x: bias.0, y: bias.1, z: bias.2, w: 0),
    ])
  }

  /// Five-point tone curve (x, y in 0...1).
  private static func curve(_ image: CIImage, _ p: [(CGFloat, CGFloat)]) -> CIImage {
    var params: [String: Any] = [:]
    for (i, point) in p.prefix(5).enumerated() {
      params["inputPoint\(i)"] = CIVector(x: point.0, y: point.1)
    }
    return image.applyingFilter("CIToneCurve", parameters: params)
  }

  /// Tints shadows and highlights separately (luminance-weighted).
  private static func splitTone(_ image: CIImage, shadows: (CGFloat, CGFloat, CGFloat), highlights: (CGFloat, CGFloat, CGFloat)) -> CIImage {
    let shadowTinted = gains(image, r: 1, g: 1, b: 1, bias: shadows)
    let highlightTinted = gains(image, r: 1, g: 1, b: 1, bias: highlights)
    let mask = controls(image, saturation: 0)
    return highlightTinted.applyingFilter("CIBlendWithMask", parameters: [
      kCIInputBackgroundImageKey: shadowTinted,
      kCIInputMaskImageKey: mask,
    ])
  }

  // MARK: Looks

  /// Applies the look at full strength (no-op for unknown ids).
  static func apply(_ id: String, to image: CIImage) -> CIImage {
    switch id {
    case "natural":
      return controls(image.applyingFilter("CIVibrance", parameters: ["inputAmount": 0.15]), contrast: 1.04)
    case "vivid":
      return controls(image.applyingFilter("CIVibrance", parameters: ["inputAmount": 0.2]), saturation: 1.25, contrast: 1.12)
    case "warm":
      return curve(gains(image, r: 1.06, g: 1.0, b: 0.92), [(0, 0.02), (0.25, 0.26), (0.5, 0.51), (0.75, 0.76), (1, 1)])
    case "cool":
      return gains(image, r: 0.94, g: 1.0, b: 1.07)
    case "golden":
      let warmed = gains(image.applyingFilter("CIVibrance", parameters: ["inputAmount": 0.25]), r: 1.08, g: 1.02, b: 0.88)
      return splitTone(warmed, shadows: (0.0, -0.01, 0.02), highlights: (0.06, 0.03, -0.03))
    case "cinematic":
      let toned = splitTone(image, shadows: (-0.02, 0.05, 0.07), highlights: (0.08, 0.03, -0.04))
      return controls(toned, saturation: 0.9, contrast: 1.1)
    case "film":
      let faded = curve(image, [(0, 0.06), (0.25, 0.24), (0.5, 0.52), (0.75, 0.79), (1, 0.96)])
      return controls(gains(faded, r: 1.03, g: 1.0, b: 0.96), saturation: 0.92)
    case "moody":
      let darker = image.applyingFilter("CIExposureAdjust", parameters: [kCIInputEVKey: -0.2])
      let toned = splitTone(darker, shadows: (-0.02, 0.0, 0.04), highlights: (0.02, 0.01, -0.01))
      return controls(toned, saturation: 0.75, contrast: 1.15)
    case "fade":
      return controls(curve(image, [(0, 0.12), (0.25, 0.3), (0.5, 0.53), (0.75, 0.76), (1, 0.95)]), saturation: 0.85)
    case "bw":
      return controls(image, saturation: 0, contrast: 1.1)
    case "noir":
      return image.applyingFilter("CIPhotoEffectNoir")
    case "vintage":
      return curve(image.applyingFilter("CIPhotoEffectInstant"), [(0, 0.05), (0.25, 0.27), (0.5, 0.52), (0.75, 0.77), (1, 0.97)])
    case "chrome":
      return image.applyingFilter("CIPhotoEffectChrome")
    default:
      return image
    }
  }

  /// Blends the look over the image at `intensity` (0...1).
  static func apply(_ id: String, intensity: Double, to image: CIImage) -> CIImage {
    let amount = max(0, min(1, intensity))
    guard amount > 0.001, ids.contains(id) else { return image }
    let looked = apply(id, to: image)
    if amount >= 0.999 { return looked }
    return image.applyingFilter("CIDissolveTransition", parameters: [
      kCIInputTargetImageKey: looked,
      kCIInputTimeKey: amount,
    ])
  }

  // MARK: LUTs for the live viewfinder

  private static let cubeSize = 33
  private static var cubeCache: [String: Data] = [:]
  private static let cubeLock = NSLock()

  /// 33³ colour cube equivalent to the look (computed once, cached).
  static func cubeData(for id: String, context: CIContext) -> Data? {
    guard ids.contains(id) else { return nil }
    cubeLock.lock()
    if let cached = cubeCache[id] {
      cubeLock.unlock()
      return cached
    }
    cubeLock.unlock()

    let size = cubeSize
    var identity = [Float](repeating: 0, count: size * size * size * 4)
    var i = 0
    for b in 0..<size {
      for g in 0..<size {
        for r in 0..<size {
          identity[i] = Float(r) / Float(size - 1)
          identity[i + 1] = Float(g) / Float(size - 1)
          identity[i + 2] = Float(b) / Float(size - 1)
          identity[i + 3] = 1
          i += 4
        }
      }
    }
    let rowBytes = size * 4 * MemoryLayout<Float>.size
    let extent = CGRect(x: 0, y: 0, width: size, height: size * size)
    let input = CIImage(
      bitmapData: identity.withUnsafeBufferPointer { Data(buffer: $0) },
      bytesPerRow: rowBytes,
      size: extent.size,
      format: .RGBAf,
      colorSpace: sRGB
    )
    let output = apply(id, to: input).cropped(to: extent)
    var result = [Float](repeating: 0, count: size * size * size * 4)
    result.withUnsafeMutableBytes { buffer in
      context.render(output, toBitmap: buffer.baseAddress!, rowBytes: rowBytes, bounds: extent, format: .RGBAf, colorSpace: sRGB)
    }
    // Keep values in range; alpha stays opaque.
    for j in stride(from: 0, to: result.count, by: 4) {
      result[j] = max(0, min(1, result[j]))
      result[j + 1] = max(0, min(1, result[j + 1]))
      result[j + 2] = max(0, min(1, result[j + 2]))
      result[j + 3] = 1
    }
    let data = result.withUnsafeBufferPointer { Data(buffer: $0) }
    cubeLock.lock()
    cubeCache[id] = data
    cubeLock.unlock()
    return data
  }

  /// Fast LUT-based look for live preview frames.
  static func applyLUT(_ id: String, intensity: Double, to image: CIImage, context: CIContext) -> CIImage {
    let amount = max(0, min(1, intensity))
    guard amount > 0.001, let data = cubeData(for: id, context: context) else { return image }
    let looked = image.applyingFilter("CIColorCubeWithColorSpace", parameters: [
      "inputCubeDimension": cubeSize,
      "inputCubeData": data,
      "inputColorSpace": sRGB,
    ])
    if amount >= 0.999 { return looked }
    return image.applyingFilter("CIDissolveTransition", parameters: [
      kCIInputTargetImageKey: looked,
      kCIInputTimeKey: amount,
    ])
  }
}
