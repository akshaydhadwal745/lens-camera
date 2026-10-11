package expo.modules.lenscamera.imaging

/**
 * Portrait styles: a few looks applied around the subject mask, the same in the
 * saved photo ([EditRenderer]) and in the live viewfinder (GlPreview). Natural
 * is just the blur. Kept subtle on purpose: realistic portraits, not filters.
 * Research: docs/research/portrait.md.
 */
object PortraitStyle {
  val IDS = listOf("natural", "studio", "mono", "stage")

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
