package expo.modules.lenscamera

import expo.modules.lenscamera.imaging.JpegMask
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class JpegMaskTest {
  /** SOI, APP1 (fake EXIF, 6 bytes payload), DQT stub, SOS, data, EOI. */
  private val jpeg = byteArrayOf(
    0xFF.toByte(), 0xD8.toByte(),
    0xFF.toByte(), 0xE1.toByte(), 0x00, 0x08, 'E'.code.toByte(), 'x'.code.toByte(), 'i'.code.toByte(), 'f'.code.toByte(), 0, 0,
    0xFF.toByte(), 0xDB.toByte(), 0x00, 0x03, 0x01,
    0xFF.toByte(), 0xDA.toByte(), 0x00, 0x02, 0x11, 0x22,
    0xFF.toByte(), 0xD9.toByte(),
  )

  @Test
  fun roundTrip() {
    val png = ByteArray(300) { it.toByte() }
    val out = JpegMask.embed(jpeg, png)
    assertEquals(jpeg.size + png.size + 9 + 4, out.size)
    assertArrayEquals(png, JpegMask.extract(out))
    // EXIF stays the first segment.
    assertEquals(0xE1.toByte(), out[3])
    // Everything after the insertion point is unchanged.
    assertArrayEquals(jpeg.copyOfRange(12, jpeg.size), out.copyOfRange(out.size - (jpeg.size - 12), out.size))
  }

  @Test
  fun noMask() {
    assertNull(JpegMask.extract(jpeg))
    assertNull(JpegMask.extract(byteArrayOf(1, 2, 3)))
  }
}
