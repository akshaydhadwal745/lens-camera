package expo.modules.lenscamera.imaging

import android.util.Log
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.RandomAccessFile

/**
 * Motion photo files (checklist 9.2), Google's Motion Photo format v1: the JPEG,
 * then the MP4 appended after it; the JPEG's XMP says so (Camera:MotionPhoto +
 * a Container:Directory listing the parts with the video's length). Google
 * Photos and Lens play it; everything else just sees the photo. Ultra HDR
 * photos keep their gain map: the video is listed after it.
 */
object MotionPhoto {
  private const val TAG = "LensMotion"
  private const val XMP_NS = "http://ns.adobe.com/xap/1.0/\u0000"
  private const val CAMERA_NS = "http://ns.google.com/photos/1.0/camera/"
  private const val CONTAINER_NS = "http://ns.google.com/photos/1.0/container/"
  private const val ITEM_NS = "http://ns.google.com/photos/1.0/container/item/"

  /** Make [jpeg] a motion photo with [mp4] (still at [stillUs] in it). False (file untouched) if it can't. */
  fun embed(jpeg: File, mp4: File, stillUs: Long): Boolean {
    try {
      val bytes = jpeg.readBytes()
      val video = mp4.readBytes()
      val out = embedBytes(bytes, video.size.toLong(), stillUs) ?: return false
      val tmp = File(jpeg.parentFile, jpeg.name + ".motion")
      tmp.outputStream().use { it.write(out); it.write(video) }
      if (!tmp.renameTo(jpeg)) {
        tmp.delete()
        return false
      }
      return true
    } catch (e: Exception) {
      Log.w(TAG, "motion photo embed failed", e)
      return false
    }
  }

  /** The JPEG with motion photo XMP (the caller appends the [videoLength]-byte MP4), or null. */
  internal fun embedBytes(jpeg: ByteArray, videoLength: Long, stillUs: Long): ByteArray? {
    if (jpeg.size < 4 || jpeg[0] != 0xFF.toByte() || jpeg[1] != 0xD8.toByte()) return null
    // Walk the header segments up to the image data.
    var pos = 2
    var insertAt = 2
    var leading = true
    var xmp: IntRange? = null
    while (pos + 4 <= jpeg.size && jpeg[pos] == 0xFF.toByte()) {
      val marker = jpeg[pos + 1].toInt() and 0xFF
      if (marker == 0xDA || marker == 0xD9) break
      val length = ((jpeg[pos + 2].toInt() and 0xFF) shl 8) or (jpeg[pos + 3].toInt() and 0xFF)
      val end = pos + 2 + length
      if (end > jpeg.size) return null
      val isXmp = marker == 0xE1 && String(jpeg, pos + 4, minOf(XMP_NS.length, length - 2), Charsets.ISO_8859_1) == XMP_NS
      if (isXmp && xmp == null) xmp = pos until end
      // The new XMP goes after JFIF/EXIF (APP0/APP1), before everything else (MPF offsets are relative, so they survive).
      if (leading && (marker == 0xE0 || marker == 0xE1)) insertAt = end else leading = false
      pos = end
    }
    val segment: ByteArray
    val replace: IntRange?
    if (xmp != null) {
      val text = String(jpeg, xmp.first + 4 + XMP_NS.length, xmp.last + 1 - (xmp.first + 4 + XMP_NS.length), Charsets.UTF_8)
      val merged = mergeXmp(text, videoLength, stillUs) ?: return null
      segment = xmpSegment(merged)
      replace = xmp
    } else {
      segment = xmpSegment(freshXmp(videoLength, stillUs))
      replace = null
    }
    val out = ByteArrayOutputStream(jpeg.size + segment.size + 16)
    if (replace != null) {
      out.write(jpeg, 0, replace.first)
      out.write(segment)
      out.write(jpeg, replace.last + 1, jpeg.size - replace.last - 1)
    } else {
      out.write(jpeg, 0, insertAt)
      out.write(segment)
      out.write(jpeg, insertAt, jpeg.size - insertAt)
    }
    return out.toByteArray()
  }

  private fun xmpSegment(xml: String): ByteArray {
    val payload = XMP_NS.toByteArray(Charsets.ISO_8859_1) + xml.toByteArray(Charsets.UTF_8)
    require(payload.size + 2 <= 0xFFFF) { "XMP too large" }
    val length = payload.size + 2
    return byteArrayOf(0xFF.toByte(), 0xE1.toByte(), (length shr 8).toByte(), length.toByte()) + payload
  }

  private fun motionAttributes(stillUs: Long) =
    """ Camera:MotionPhoto="1" Camera:MotionPhotoVersion="1" Camera:MotionPhotoPresentationTimestampUs="$stillUs""""

  private fun videoItem(videoLength: Long) =
    """<rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="video/mp4" Item:Semantic="MotionPhoto" Item:Length="$videoLength" Item:Padding="0"/></rdf:li>"""

  internal fun freshXmp(videoLength: Long, stillUs: Long): String =
    """<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Lens"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">""" +
      """<rdf:Description rdf:about="" xmlns:Camera="$CAMERA_NS" xmlns:GCamera="$CAMERA_NS" xmlns:Container="$CONTAINER_NS" xmlns:Item="$ITEM_NS"""" +
      motionAttributes(stillUs) +
      """ GCamera:MicroVideo="1" GCamera:MicroVideoVersion="1" GCamera:MicroVideoOffset="$videoLength" GCamera:MicroVideoPresentationTimestampUs="$stillUs">""" +
      """<Container:Directory><rdf:Seq>""" +
      """<rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="image/jpeg" Item:Semantic="Primary" Item:Length="0" Item:Padding="0"/></rdf:li>""" +
      videoItem(videoLength) +
      """</rdf:Seq></Container:Directory></rdf:Description></rdf:RDF></x:xmpmeta>"""

  /**
   * Existing XMP (Ultra HDR has one with a gain-map directory): add the motion
   * attributes and list the video last. Null when it doesn't have the expected shape.
   */
  internal fun mergeXmp(xml: String, videoLength: Long, stillUs: Long): String? {
    if (xml.contains("MotionPhoto")) return null
    val dir = xml.indexOf("Container:Directory")
    if (dir < 0) return null
    val seqEnd = xml.indexOf("</rdf:Seq>", dir)
    val desc = xml.indexOf("<rdf:Description")
    if (seqEnd < 0 || desc < 0 || desc > dir) return null
    val attrsAt = desc + "<rdf:Description".length
    val camera = if (xml.contains("xmlns:Camera=")) "" else """ xmlns:Camera="$CAMERA_NS""""
    return xml.substring(0, attrsAt) + camera + motionAttributes(stillUs) +
      xml.substring(attrsAt, seqEnd) + videoItem(videoLength) + xml.substring(seqEnd)
  }

  /** Where the video sits in a motion photo: (offset, length) or null if [file] isn't one. */
  fun locate(file: File): Pair<Long, Long>? {
    val size = file.length()
    if (size < 16) return null
    val head = RandomAccessFile(file, "r").use { f ->
      val n = minOf(size, 256 * 1024L).toInt()
      ByteArray(n).also { f.readFully(it) }
    }
    val text = String(head, Charsets.ISO_8859_1)
    val length = videoLength(text) ?: return null
    if (length <= 0 || length >= size) return null
    val offset = size - length
    // Sanity check: an MP4 starts with a box whose type is "ftyp".
    val ftyp = RandomAccessFile(file, "r").use { f ->
      f.seek(offset + 4)
      ByteArray(4).also { f.readFully(it) }
    }
    return if (String(ftyp, Charsets.ISO_8859_1) == "ftyp") offset to length else null
  }

  internal fun videoLength(xmp: String): Long? {
    Regex("""<Container:Item[^>]*Item:Semantic="MotionPhoto"[^>]*>""").find(xmp)?.value?.let { item ->
      Regex("""Item:Length="(\d+)"""").find(item)?.groupValues?.get(1)?.toLongOrNull()?.let { return it }
    }
    return Regex("""MicroVideoOffset="(\d+)"""").find(xmp)?.groupValues?.get(1)?.toLongOrNull()
  }

  /** Copy the video of a motion photo into [out]; false if [file] has none. */
  fun extract(file: File, out: File): Boolean {
    val (offset, length) = locate(file) ?: return false
    RandomAccessFile(file, "r").use { f ->
      f.seek(offset)
      out.outputStream().use { o ->
        val buf = ByteArray(64 * 1024)
        var left = length
        while (left > 0) {
          val n = f.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
          if (n <= 0) break
          o.write(buf, 0, n)
          left -= n
        }
      }
    }
    return true
  }
}
