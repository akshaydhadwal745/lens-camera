package expo.modules.lenscamera

import expo.modules.lenscamera.imaging.MotionPhoto
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class MotionPhotoTest {
  private fun segment(marker: Int, payload: ByteArray): ByteArray {
    val length = payload.size + 2
    return byteArrayOf(0xFF.toByte(), marker.toByte(), (length shr 8).toByte(), length.toByte()) + payload
  }

  private val exif = segment(0xE1, "Exif\u0000\u0000fake-tiff".toByteArray(Charsets.ISO_8859_1))
  private val mpf = segment(0xE2, "MPF\u0000offsets".toByteArray(Charsets.ISO_8859_1))
  private val scan = byteArrayOf(0xFF.toByte(), 0xDA.toByte(), 0, 4, 1, 2, 9, 9, 9, 0xFF.toByte(), 0xD9.toByte())
  private val soi = byteArrayOf(0xFF.toByte(), 0xD8.toByte())

  /** Fake MP4: a box whose type is "ftyp", then data. */
  private val mp4 = byteArrayOf(0, 0, 0, 16) + "ftypisom".toByteArray() + ByteArray(40) { it.toByte() }

  private fun motionFile(jpeg: ByteArray): File {
    val out = MotionPhoto.embedBytes(jpeg, mp4.size.toLong(), 1_234_567)!!
    return File.createTempFile("motion", ".jpg").apply {
      writeBytes(out + mp4)
      deleteOnExit()
    }
  }

  @Test
  fun plainJpegGetsXmpAfterExifAndVideoAtTheEnd() {
    val jpeg = soi + exif + mpf + scan
    val file = motionFile(jpeg)
    val bytes = file.readBytes()
    // EXIF stays first, the XMP follows it, the rest of the JPEG is unchanged.
    assertArrayEquals(soi + exif, bytes.copyOfRange(0, soi.size + exif.size))
    val text = String(bytes, Charsets.ISO_8859_1)
    assertTrue(text.indexOf("http://ns.adobe.com/xap/1.0/") in soi.size + exif.size until soi.size + exif.size + 10)
    assertTrue(text.contains("Camera:MotionPhoto=\"1\""))
    assertTrue(text.contains("Camera:MotionPhotoPresentationTimestampUs=\"1234567\""))
    val (offset, length) = MotionPhoto.locate(file)!!
    assertEquals(mp4.size.toLong(), length)
    assertArrayEquals(mp4, bytes.copyOfRange(offset.toInt(), bytes.size))
    val out = File.createTempFile("clip", ".mp4").apply { deleteOnExit() }
    assertTrue(MotionPhoto.extract(file, out))
    assertArrayEquals(mp4, out.readBytes())
  }

  @Test
  fun ultraHdrDirectoryKeepsGainMapAndListsVideoLast() {
    val xml = """<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">""" +
      """<rdf:Description xmlns:Container="http://ns.google.com/photos/1.0/container/" xmlns:Item="http://ns.google.com/photos/1.0/container/item/" xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/" hdrgm:Version="1.0">""" +
      """<Container:Directory><rdf:Seq><rdf:li rdf:parseType="Resource"><Container:Item Item:Semantic="Primary" Item:Mime="image/jpeg"/></rdf:li>""" +
      """<rdf:li rdf:parseType="Resource"><Container:Item Item:Semantic="GainMap" Item:Mime="image/jpeg" Item:Length="5000"/></rdf:li></rdf:Seq></Container:Directory>""" +
      """</rdf:Description></rdf:RDF></x:xmpmeta>"""
    val merged = MotionPhoto.mergeXmp(xml, 48, 1_000)!!
    assertTrue(merged.indexOf("GainMap") < merged.indexOf("Item:Semantic=\"MotionPhoto\""))
    assertTrue(merged.contains("hdrgm:Version=\"1.0\""))
    assertTrue(merged.contains("xmlns:Camera="))
    assertEquals(48L, MotionPhoto.videoLength(merged))
    // Already a motion photo / no directory: leave the file alone.
    assertNull(MotionPhoto.mergeXmp(merged, 48, 1_000))
    assertNull(MotionPhoto.mergeXmp("<x:xmpmeta><rdf:Description/></x:xmpmeta>", 48, 1_000))

    val xmpPayload = "http://ns.adobe.com/xap/1.0/\u0000".toByteArray(Charsets.ISO_8859_1) + xml.toByteArray()
    val jpeg = soi + exif + segment(0xE1, xmpPayload) + mpf + scan
    val file = motionFile(jpeg)
    val text = String(file.readBytes(), Charsets.ISO_8859_1)
    // One XMP (replaced, not duplicated), MPF still after it.
    assertEquals(1, Regex("http://ns.adobe.com/xap/1.0/").findAll(text).count())
    assertTrue(text.indexOf("MPF") > text.indexOf("MotionPhoto"))
    assertNotNull(MotionPhoto.locate(file))
  }

  @Test
  fun ordinaryPhotoIsNotAMotionPhoto() {
    val file = File.createTempFile("plain", ".jpg").apply {
      writeBytes(soi + exif + scan)
      deleteOnExit()
    }
    assertNull(MotionPhoto.locate(file))
  }
}
