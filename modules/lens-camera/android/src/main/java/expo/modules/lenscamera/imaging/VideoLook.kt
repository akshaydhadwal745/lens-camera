package expo.modules.lenscamera.imaging

import android.content.Context
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer

/**
 * Live look on playback: a video keeps its look as a non-destructive recipe
 * (the original file is untouched), so the player runs the same GPU shader as
 * [VideoExport] on every frame instead of re-encoding the file.
 */
@OptIn(UnstableApi::class)
object VideoLook {
  /** expo-video's VideoPlayer exposes `val player: ExoPlayer` (read without a compile-time dependency). */
  fun exoPlayerOf(sharedObject: Any): ExoPlayer? =
    runCatching { sharedObject.javaClass.getMethod("getPlayer").invoke(sharedObject) as? ExoPlayer }.getOrNull()

  fun apply(context: Context, player: ExoPlayer?, recipe: EditRecipe?) {
    if (player == null) {
      Log.w("LensImaging", "setVideoLook: not an expo-video player")
      return
    }
    val colour = recipe?.colourOnly()
    try {
      player.setVideoEffects(if (colour != null) listOf(VideoExport.RecipeEffect(context.applicationContext, colour)) else emptyList())
      // Effects are wired up when the video renderer starts: a player that is
      // already prepared (preloaded) is re-prepared at the same spot.
      if (player.playbackState != Player.STATE_IDLE) {
        val position = player.currentPosition
        val playWhenReady = player.playWhenReady
        player.stop()
        player.prepare()
        player.seekTo(position)
        player.playWhenReady = playWhenReady
      }
    } catch (e: Exception) {
      // No look is better than no video.
      Log.w("LensImaging", "Video look not applied", e)
      runCatching { player.setVideoEffects(emptyList()) }
    }
  }
}
