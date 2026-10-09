package expo.modules.lenscamera.imaging

/**
 * Non-destructive edit recipe. Mirrors `EditRecipe` in src/lib/edits.ts and
 * ios/Imaging/EditRecipe.swift. Missing values are neutral.
 */
data class EditRecipe(
  val look: String? = null,
  val intensity: Double = 1.0,
  val auto: Boolean = false,
  val exposure: Double = 0.0,
  val contrast: Double = 0.0,
  val highlights: Double = 0.0,
  val shadows: Double = 0.0,
  val warmth: Double = 0.0,
  val tint: Double = 0.0,
  val saturation: Double = 0.0,
  val vibrance: Double = 0.0,
  val sharpness: Double = 0.0,
  val vignette: Double = 0.0,
  val grain: Double = 0.0,
  val crop: Crop? = null,
  /** Portrait blur as an f-number (1.4 strong … 16 none), or null. */
  val aperture: Double? = null,
) {
  data class Crop(
    val x: Double? = null,
    val y: Double? = null,
    val w: Double? = null,
    val h: Double? = null,
    /** Quarter turns clockwise. */
    val rotate: Int = 0,
    /** Degrees, -45…45. */
    val straighten: Double = 0.0,
    val flip: Boolean = false,
  )

  /** Looks and colour only: what applies to videos. */
  fun colourOnly() = copy(crop = null, aperture = null)

  companion object {
    fun from(map: Map<String, Any?>?): EditRecipe? {
      if (map.isNullOrEmpty()) return null
      @Suppress("UNCHECKED_CAST")
      val adjust = map["adjust"] as? Map<String, Any?> ?: emptyMap()
      @Suppress("UNCHECKED_CAST")
      val crop = (map["crop"] as? Map<String, Any?>)?.let { c ->
        Crop(
          x = num(c["x"]),
          y = num(c["y"]),
          w = num(c["w"]),
          h = num(c["h"]),
          rotate = num(c["rotate"])?.toInt() ?: 0,
          straighten = num(c["straighten"]) ?: 0.0,
          flip = c["flip"] == true,
        )
      }
      @Suppress("UNCHECKED_CAST")
      val portrait = map["portrait"] as? Map<String, Any?>
      return EditRecipe(
        look = map["look"] as? String,
        intensity = num(map["intensity"]) ?: 1.0,
        auto = map["auto"] == true,
        exposure = num(adjust["exposure"]) ?: 0.0,
        contrast = num(adjust["contrast"]) ?: 0.0,
        highlights = num(adjust["highlights"]) ?: 0.0,
        shadows = num(adjust["shadows"]) ?: 0.0,
        warmth = num(adjust["warmth"]) ?: 0.0,
        tint = num(adjust["tint"]) ?: 0.0,
        saturation = num(adjust["saturation"]) ?: 0.0,
        vibrance = num(adjust["vibrance"]) ?: 0.0,
        sharpness = num(adjust["sharpness"]) ?: 0.0,
        vignette = num(adjust["vignette"]) ?: 0.0,
        grain = num(adjust["grain"]) ?: 0.0,
        crop = crop,
        aperture = num(portrait?.get("aperture")),
      )
    }

    private fun num(v: Any?): Double? = (v as? Number)?.toDouble()
  }
}
