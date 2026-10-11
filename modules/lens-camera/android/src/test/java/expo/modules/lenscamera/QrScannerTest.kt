package expo.modules.lenscamera

import expo.modules.lenscamera.gl.QrScanner
import org.junit.Assert.assertEquals
import org.junit.Test

class QrScannerTest {
  @Test
  fun plainTextLinksBecomeLinks() {
    assertEquals("url", QrScanner.kindOf("https://lens.instagrowapp.com/l/abc")["kind"])
    assertEquals("https://example.com/x", QrScanner.kindOf("  https://example.com/x \n")["url"])
    assertEquals("text", QrScanner.kindOf("hello world")["kind"])
    // Other schemes are never treated as links to open.
    assertEquals("text", QrScanner.kindOf("intent://evil#Intent;end")["kind"])
    assertEquals("text", QrScanner.kindOf("javascript:alert(1)")["kind"])
  }
}
