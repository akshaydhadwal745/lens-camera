// Bakes the iOS looks (ios/Imaging/Looks.swift) into 33³ LUT strips for
// Android, so a look is pixel-for-pixel the same on both platforms.
//
//   swiftc -O tools/bake-looks.swift ios/Imaging/Looks.swift -o /tmp/bake-looks
//   /tmp/bake-looks android/src/main/assets/looks
//
// Output: <id>.png, 1089×33 RGBA. Column b·33 + r, row g (see LookLut.kt).
import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers

let outDir = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "looks")
try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
let context = CIContext(options: [.cacheIntermediates: false])
let n = 33
let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!

for id in Looks.ids {
  guard let cube = Looks.cubeData(for: id, context: context) else {
    print("skip \(id)")
    continue
  }
  // cube: Float RGBA, r fastest, then g, then b.
  let floats = cube.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
  var bytes = [UInt8](repeating: 255, count: n * n * n * 4)
  for b in 0..<n {
    for g in 0..<n {
      for r in 0..<n {
        let src = ((b * n + g) * n + r) * 4
        let dst = (g * n * n + b * n + r) * 4
        for c in 0..<3 {
          bytes[dst + c] = UInt8(max(0, min(255, (floats[src + c] * 255).rounded())))
        }
      }
    }
  }
  let provider = CGDataProvider(data: Data(bytes) as CFData)!
  let image = CGImage(
    width: n * n, height: n, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: n * n * 4,
    space: sRGB, bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue),
    provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent
  )!
  let url = outDir.appendingPathComponent("\(id).png")
  let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, image, nil)
  CGImageDestinationFinalize(dest)
  print("baked \(id)")
}
