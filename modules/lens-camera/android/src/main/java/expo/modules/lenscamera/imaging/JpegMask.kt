package expo.modules.lenscamera.imaging

import java.io.ByteArrayOutputStream
import java.io.File

/**
 * Stores a small subject mask (PNG) inside a JPEG as an APP9 segment tagged
 * "LENSMASK". Image viewers ignore unknown APP segments, the photo's pixels
 * and EXIF are untouched, and the mask travels with the file (cloud, other
 * phones). Same idea as Google Camera's depth map in portrait JPEGs.
 *
 * Pure Kotlin (bytes in, bytes out) so it can be unit tested on the JVM.
 */
object JpegMask {
  private val SIGNATURE = "LENSMASK\u0000".toByteArray(Charsets.US_ASCII)
  private const val APP9 = 0xE9
  /** A JPEG segment holds at most 65533 payload bytes. */
  const val MAX_MASK_BYTES = 65533 - 9

  fun embed(jpeg: ByteArray, png: ByteArray): ByteArray {
    require(png.size <= MAX_MASK_BYTES) { "Mask too large" }
    require(jpeg.size > 4 && jpeg[0] == 0xFF.toByte() && jpeg[1] == 0xD8.toByte()) { "Not a JPEG" }
    // Insert after SOI and the leading APPn segments (EXIF/JFIF stay first).
    var pos = 2
    while (pos + 4 <= jpeg.size && jpeg[pos] == 0xFF.toByte()) {
      val marker = jpeg[pos + 1].toInt() and 0xFF
      if (marker !in 0xE0..0xEF) break
      val length = ((jpeg[pos + 2].toInt() and 0xFF) shl 8) or (jpeg[pos + 3].toInt() and 0xFF)
      pos += 2 + length
    }
    val payload = SIGNATURE + png
    val segLength = payload.size + 2
    val out = ByteArrayOutputStream(jpeg.size + payload.size + 4)
    out.write(jpeg, 0, pos)
    out.write(0xFF)
    out.write(APP9)
    out.write(segLength shr 8)
    out.write(segLength and 0xFF)
    out.write(payload)
    out.write(jpeg, pos, jpeg.size - pos)
    return out.toByteArray()
  }

  /** The embedded mask PNG, or null. Scans only the header segments. */
  fun extract(jpeg: ByteArray): ByteArray? {
    if (jpeg.size < 4 || jpeg[0] != 0xFF.toByte() || jpeg[1] != 0xD8.toByte()) return null
    var pos = 2
    while (pos + 4 <= jpeg.size && jpeg[pos] == 0xFF.toByte()) {
      val marker = jpeg[pos + 1].toInt() and 0xFF
      if (marker == 0xDA || marker == 0xD9) return null // image data / end: no mask
      val length = ((jpeg[pos + 2].toInt() and 0xFF) shl 8) or (jpeg[pos + 3].toInt() and 0xFF)
      if (marker == APP9 && length - 2 > SIGNATURE.size) {
        val start = pos + 4
        if (SIGNATURE.indices.all { jpeg[start + it] == SIGNATURE[it] }) {
          return jpeg.copyOfRange(start + SIGNATURE.size, pos + 2 + length)
        }
      }
      pos += 2 + length
    }
    return null
  }

  /** Reads only the start of the file (masks sit right after EXIF). */
  fun extract(file: File): ByteArray? {
    if (!file.exists()) return null
    val head = file.inputStream().use { input ->
      val buffer = ByteArray(minOf(file.length(), 512L * 1024).toInt())
      var read = 0
      while (read < buffer.size) {
        val n = input.read(buffer, read, buffer.size - read)
        if (n < 0) break
        read += n
      }
      buffer.copyOf(read)
    }
    return extract(head)
  }
}
