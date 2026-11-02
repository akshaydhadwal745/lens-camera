// "This device is ours": open any page once with ?internal=1 on the owner's or a tester's phone or
// laptop and neither Google Analytics nor our own analytics count that browser again (?internal=0
// undoes it). Per browser, not per network, so real visitors on a shared office Wi-Fi still count.
export function internalDevice(): boolean {
  try {
    const flag = new URLSearchParams(location.search).get('internal');
    if (flag === '1') localStorage.setItem('lens-internal', '1');
    if (flag === '0') localStorage.removeItem('lens-internal');
    return localStorage.getItem('lens-internal') === '1';
  } catch {
    return false;
  }
}
