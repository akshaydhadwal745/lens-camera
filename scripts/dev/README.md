# Dev helpers (testing on the emulator / against the live API)

- `emu-ui.sh tap "<text|content-desc>" | texts | shot <name>`: drive the
  emulator app via uiautomator (needs `~/.local/bin/android-env.sh`; screenshots
  land next to the script, `<name>-s.png` is a 405 px copy).
- `friend-share.sh <recipient Lens name>`: plays "a friend": a throwaway identity
  (token kept in `$TMPDIR/lens-friend.token`) uploads the GPS fixture photo and
  shares it with that name (prints the request id + status).
- `watch_ci.py <commit sha>`: waits until the "App builds" run's Android jobs +
  release (or the whole run) finish and prints each job's result.
