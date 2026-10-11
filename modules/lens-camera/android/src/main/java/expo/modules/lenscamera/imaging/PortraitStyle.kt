package expo.modules.lenscamera.imaging

/**
 * Portrait styles: a few looks applied around the subject mask, the same in the
 * saved photo ([EditRenderer]) and in the live viewfinder (GlPreview). Natural
 * is just the blur. Kept subtle on purpose: realistic portraits, not filters.
 * Research: docs/research/portrait.md.
 */
object PortraitStyle {
  val IDS = listOf("natural", "studio", "mono", "stage")

  /**
   * Background blur radius as a fraction of the photo's long side for an
   * f-number (f/1.4 strongest ≈ 2.4 % … f/16 none). Prototype on real S8
   * portraits: 2.2 % at f/2.8 reads like a real fast lens.
   */
  fun blurFraction(aperture: Double?): Float {
    val a = aperture ?: return 0f
    val k = (1 - (a - 1.4) / 14.6).coerceIn(0.0, 1.0)
    return (0.024 * k).toFloat()
  }

  /**
   * Automatic blur strength (Normal camera, checklist 4.4): like a real lens, the
   * closer the subject (the more of the frame the person fills) the shallower the
   * depth of field. Coverage 0…1 → f-number: ≥ 55 % f/1.8, 30 % f/2.8, 12 % f/4,
   * smaller f/5.6, linear in between.
   */
  fun autoAperture(coverage: Double): Double {
    val points = listOf(0.05 to 5.6, 0.12 to 4.0, 0.30 to 2.8, 0.55 to 1.8)
    if (coverage <= points.first().first) return points.first().second
    if (coverage >= points.last().first) return points.last().second
    for (k in 1 until points.size) {
      val (c0, a0) = points[k - 1]
      val (c1, a1) = points[k]
      if (coverage <= c1) return a0 + (a1 - a0) * (coverage - c0) / (c1 - c0)
    }
    return 2.8
  }

  /** Shader code for a style id (0 = natural, nothing extra). */
  fun code(id: String?): Float = when (id) {
    "studio" -> 1f
    "mono" -> 2f
    "stage" -> 3f
    else -> 0f
  }

  /**
   * `portraitStyle(colour, subject 0…1, style)`. Needs `luma()` defined first.
   * - Studio: background darker and quieter (less colour), subject untouched.
   * - Mono: black and white with a little contrast; background a step deeper.
   * - Stage: background falls to near black, like a spotlight.
   */
  const val GLSL = """
    vec3 portraitStyle(vec3 c, float subject, float style) {
      if (style < 1.5) {
        vec3 bg = mix(vec3(luma(c)), c, 0.5) * 0.6;
        return mix(bg, c, subject);
      }
      if (style < 2.5) {
        float l = clamp((luma(c) - 0.5) * 1.12 + 0.5, 0.0, 1.0);
        return mix(vec3(l * 0.78), vec3(l), subject);
      }
      return mix(c * 0.07, c, subject);
    }
  """
}
