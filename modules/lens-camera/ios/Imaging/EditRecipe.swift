import Foundation

/// Non-destructive edit recipe. Mirrors `EditRecipe` in src/lib/edits.ts.
/// Every field is optional; missing = neutral. The original is never modified:
/// a recipe is applied when rendering previews, the editor, and exports.
struct EditRecipe: Codable, Equatable {
  struct Adjust: Codable, Equatable {
    var exposure: Double?    // EV, -2...2
    var contrast: Double?    // -1...1
    var highlights: Double?  // -1...1 (negative recovers)
    var shadows: Double?     // -1...1 (positive lifts)
    var warmth: Double?      // -1...1
    var tint: Double?        // -1...1 (positive = magenta)
    var saturation: Double?  // -1...1
    var vibrance: Double?    // -1...1
    var sharpness: Double?   // 0...1
    var vignette: Double?    // 0...1
    var grain: Double?       // 0...1
  }

  struct Crop: Codable, Equatable {
    /// Normalised rect in the rotated + straightened image, origin top-left.
    var x: Double?
    var y: Double?
    var w: Double?
    var h: Double?
    /// Quarter turns clockwise (0...3).
    var rotate: Int?
    /// Fine rotation in degrees (-45...45).
    var straighten: Double?
    var flip: Bool?
  }

  struct Portrait: Codable, Equatable {
    /// f-number of the simulated lens (1.4 = strong blur … 16 = almost none).
    var aperture: Double?
  }

  var v: Int?
  var look: String?
  var intensity: Double?
  var auto: Bool?
  var adjust: Adjust?
  var crop: Crop?
  var portrait: Portrait?

  static func from(_ dict: [String: Any]?) -> EditRecipe? {
    guard let dict, !dict.isEmpty,
          let data = try? JSONSerialization.data(withJSONObject: dict) else { return nil }
    return try? JSONDecoder().decode(EditRecipe.self, from: data)
  }
}
