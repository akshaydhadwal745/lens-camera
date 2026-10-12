package expo.modules.lenscamera

import expo.modules.lenscamera.imaging.MediaProbe
import expo.modules.lenscamera.imaging.MotionPhoto
import org.junit.Assert.assertEquals
import org.junit.Test

class MediaProbeTest {
  private fun segment(marker: Int, payload: String): ByteArray {
    val bytes = payload.toByteArray(Charsets.ISO_8859_1)
    val length = bytes.size + 2
    return byteArrayOf(0xFF.toByte(), marker.toByte(), (length shr 8).toByte(), length.toByte()) + bytes
  }

  private val soi = byteArrayOf(0xFF.toByte(), 0xD8.toByte())
  private val scan = byteArrayOf(0xFF.toByte(), 0xDA.toByte(), 0, 4, 1, 2, 0xFF.toByte(), 0xD9.toByte())
  private val exif = segment(0xE1, "Exif\u0000\u0000fake-tiff")
  private val mpf = segment(0xE2, "MPF\u0000offsets")
  // Ultra HDR primary XMP as phones write it: hdrgm version + a container directory listing the gain map.
  private val hdrXmp = segment(
    0xE1,
    "http://ns.adobe.com/xap/1.0/\u0000<x:xmpmeta xmlns:x=\"adobe:ns:meta/\"><rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">" +
      "<rdf:Description xmlns:Container=\"http://ns.google.com/photos/1.0/container/\" xmlns:Item=\"http://ns.google.com/photos/1.0/container/item/\" " +
      "xmlns:hdrgm=\"http://ns.adobe.com/hdr-gain-map/1.0/\" hdrgm:Version=\"1.0\"><Container:Directory><rdf:Seq>" +
      "<rdf:li rdf:parseType=\"Resource\"><Container:Item Item:Semantic=\"Primary\" Item:Mime=\"image/jpeg\"/></rdf:li>" +
      "<rdf:li rdf:parseType=\"Resource\"><Container:Item Item:Semantic=\"GainMap\" Item:Mime=\"image/jpeg\" Item:Length=\"1000\"/></rdf:li>" +
      "</rdf:Seq></Container:Directory></rdf:Description></rdf:RDF></x:xmpmeta>",
  )

  @Test
  fun plainJpegHasNothing() {
    assertEquals(MediaProbe.Markers(gainMap = false, mpf = false, motion = false), MediaProbe.markers(soi + exif + scan))
  }

  @Test
  fun ultraHdrNeedsGainMapXmpAndMpf() {
    assertEquals(MediaProbe.Markers(gainMap = true, mpf = true, motion = false), MediaProbe.markers(soi + exif + hdrXmp + mpf + scan))
    // XMP without the MPF picture index: not a usable Ultra HDR file.
    assertEquals(MediaProbe.Markers(gainMap = true, mpf = false, motion = false), MediaProbe.markers(soi + exif + hdrXmp + scan))
  }

  @Test
  fun motionPhotoWrittenByLensIsFound() {
    val plain = MotionPhoto.embedBytes(soi + exif + mpf + scan, 1000, 1_500_000)!!
    assertEquals(MediaProbe.Markers(gainMap = false, mpf = true, motion = true), MediaProbe.markers(plain))
    val hdr = MotionPhoto.embedBytes(soi + exif + hdrXmp + mpf + scan, 1000, 1_500_000)!!
    assertEquals(MediaProbe.Markers(gainMap = true, mpf = true, motion = true), MediaProbe.markers(hdr))
  }

  @Test
  fun notAJpeg() {
    assertEquals(MediaProbe.Markers(gainMap = false, mpf = false, motion = false), MediaProbe.markers(byteArrayOf(1, 2, 3)))
  }
}
