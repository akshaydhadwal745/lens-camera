# Nearby on this Wi-Fi (step 3 of docs/design/organise-and-share.md)

- **Opt-in:** Settings → Sharing → **Visible to nearby Lens users** (off by
  default). Seeing others needs nothing; being seen needs this switch.
- **Where it shows:** the roll ("quiet-tiger is nearby · Pick photos") and the
  share picker's **Nearby on this Wi-Fi** section (above Suggested). Sharing
  still goes through the confirm sheet and the recipient's accept.
- **How identity is verified, not trusted from the network:** a visible phone
  asks our API for a code (`POST /nearby/code`: 16 random characters, valid 15
  minutes, stored as `NB#<code>` with DynamoDB TTL) and announces only that
  code as an mDNS service (`_lensnearby._tcp`, Android NsdManager; no app
  permission needed). Phones collect codes they see and ask the API who they
  are (`POST /nearby/resolve`): it answers with display names only for valid
  codes of people still visible, never yourself, and never across a block. No
  names, account ids or locations travel the local network. Turning the switch
  off makes old codes resolve to nothing.
- **Battery:** discovery runs only while the roll or share picker is on screen
  (stops when the app goes to the background); the code refreshes every 10 min.
- **Native:** `modules/lens-device` `NearbyDiscovery.kt` (`nearbyStart(code)`,
  `nearbyStop()`, event `onNearby {codes}`); JS `src/lib/nearby.ts`
  (`useNearbyPeople`). Needs the APK with this module (older APKs: hidden).
- **Limits:** networks that block multicast (some office/hotel/guest Wi-Fi,
  "client isolation") hide nearby phones; then search or "My Lens code" still work.
