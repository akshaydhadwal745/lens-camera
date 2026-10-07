import CoreGraphics
import CoreVideo
import Foundation

/// What the analysis pass should produce.
struct AnalysisOptions {
  var peaking = false
  var zebra = false
  /// Luma (0...1) at or above which zebra stripes are drawn.
  var zebraLevel: Double = 0.95
  var falseColor = false
  var histogram = true

  var needsOverlay: Bool { peaking || zebra || falseColor }
  var needsAnything: Bool { needsOverlay || histogram }
}

struct FrameAnalysis {
  /// Overlay image, same aspect as the analysed frame (nil when no overlay is enabled).
  var overlay: CGImage?
  /// 64 luma bins normalised to the tallest bin (0...1).
  var histogram: [Double]?
  /// Fraction of pixels crushed to black / clipped to white.
  var clipLow: Double = 0
  var clipHigh: Double = 0
}

/// Live exposure/focus analysis on a downscaled luma image. Runs on the
/// capture analysis queue; work is ~250k pixels per frame at ~12 fps.
final class FrameAnalyzer {
  private let targetWidth = 360
  private let colorSpace = CGColorSpaceCreateDeviceRGB()

  func analyze(_ pixelBuffer: CVPixelBuffer, options: AnalysisOptions) -> FrameAnalysis {
    CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }

    let format = CVPixelBufferGetPixelFormatType(pixelBuffer)
    let planar = CVPixelBufferGetPlaneCount(pixelBuffer) > 0
    guard planar, let base = CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, 0) else { return FrameAnalysis() }

    let width = CVPixelBufferGetWidthOfPlane(pixelBuffer, 0)
    let height = CVPixelBufferGetHeightOfPlane(pixelBuffer, 0)
    let bytesPerRow = CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, 0)
    guard width > 0, height > 0 else { return FrameAnalysis() }

    let tenBit = format == kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange
      || format == kCVPixelFormatType_420YpCbCr10BiPlanarFullRange
    let videoRange = format == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
      || format == kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange

    // Downscale by integer step to roughly targetWidth columns.
    let step = max(1, width / targetWidth)
    let w = width / step
    let h = height / step
    var luma = [UInt8](repeating: 0, count: w * h)

    for y in 0..<h {
      let row = base.advanced(by: y * step * bytesPerRow)
      for x in 0..<w {
        var value: Int
        if tenBit {
          // 10-bit samples live in the high bits of 16-bit words.
          value = Int(row.load(fromByteOffset: x * step * 2, as: UInt16.self) >> 8)
        } else {
          value = Int(row.load(fromByteOffset: x * step, as: UInt8.self))
        }
        if videoRange {
          value = (value - 16) * 255 / 219
        }
        luma[y * w + x] = UInt8(max(0, min(255, value)))
      }
    }

    var result = FrameAnalysis()

    if options.histogram {
      var bins = [Int](repeating: 0, count: 64)
      var low = 0
      var high = 0
      for v in luma {
        bins[Int(v) >> 2] += 1
        if v <= 4 { low += 1 }
        if v >= 251 { high += 1 }
      }
      let peak = Double(max(1, bins.max() ?? 1))
      result.histogram = bins.map { (Double($0) / peak * 1000).rounded() / 1000 }
      let total = Double(luma.count)
      result.clipLow = Double(low) / total
      result.clipHigh = Double(high) / total
    }

    if options.needsOverlay {
      result.overlay = makeOverlay(luma: luma, width: w, height: h, options: options)
    }
    return result
  }

  private func makeOverlay(luma: [UInt8], width w: Int, height h: Int, options: AnalysisOptions) -> CGImage? {
    var rgba = [UInt8](repeating: 0, count: w * h * 4)
    let zebraThreshold = UInt8(max(0, min(255, options.zebraLevel * 255)))
    let peakingThreshold = 48

    @inline(__always) func put(_ i: Int, _ r: UInt8, _ g: UInt8, _ b: UInt8, _ a: UInt8 = 255) {
      // Premultiplied alpha.
      let o = i * 4
      rgba[o] = UInt8(Int(r) * Int(a) / 255)
      rgba[o + 1] = UInt8(Int(g) * Int(a) / 255)
      rgba[o + 2] = UInt8(Int(b) * Int(a) / 255)
      rgba[o + 3] = a
    }

    for y in 0..<h {
      for x in 0..<w {
        let i = y * w + x
        let l = luma[i]

        if options.falseColor {
          // IRE-style zones; everything else shown as grey.
          let ire = Int(l) * 100 / 255
          switch ire {
          case ..<3: put(i, 128, 0, 200)        // crushed: purple
          case 3..<10: put(i, 0, 70, 255)       // deep shadow: blue
          case 38..<45: put(i, 0, 200, 70)      // middle grey: green
          case 52..<58: put(i, 255, 140, 170)   // skin: pink
          case 93..<98: put(i, 255, 220, 0)     // near clip: yellow
          case 98...: put(i, 255, 20, 20)       // clipped: red
          default: put(i, l, l, l)
          }
        }

        if options.zebra && l >= zebraThreshold && (x + y) % 8 < 4 {
          put(i, 255, 255, 255, 230)
        }

        if options.peaking && x > 0 && y > 0 && x < w - 1 && y < h - 1 {
          let gx = abs(Int(luma[i + 1]) - Int(luma[i - 1]))
          let gy = abs(Int(luma[i + w]) - Int(luma[i - w]))
          if gx + gy > peakingThreshold && l < 250 {
            put(i, 255, 30, 90)
          }
        }
      }
    }

    let data = Data(rgba) as CFData
    guard let provider = CGDataProvider(data: data) else { return nil }
    return CGImage(
      width: w,
      height: h,
      bitsPerComponent: 8,
      bitsPerPixel: 32,
      bytesPerRow: w * 4,
      space: colorSpace,
      bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
      provider: provider,
      decode: nil,
      shouldInterpolate: false,
      intent: .defaultIntent
    )
  }
}
