// Free up space (docs/design/switch-features.md §2): removing backed-up originals
// from the phone gallery needs to read it (Android 13+: READ_MEDIA_IMAGES/VIDEO,
// asked only when the user chooses to free space) and, on Android 9–10, to delete
// directly (WRITE_EXTERNAL_STORAGE up to API 29 + legacy storage on Android 10).
// Android 11+ deletes through the system's own confirmation instead.
const { withAndroidManifest } = require('expo/config-plugins');

const PERMISSIONS = [
  { name: 'android.permission.READ_MEDIA_IMAGES' },
  { name: 'android.permission.READ_MEDIA_VIDEO' },
  { name: 'android.permission.READ_EXTERNAL_STORAGE', maxSdk: '32' },
  { name: 'android.permission.WRITE_EXTERNAL_STORAGE', maxSdk: '29' },
];

module.exports = function withGalleryCleanup(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest['uses-permission'] = manifest['uses-permission'] ?? [];
    for (const p of PERMISSIONS) {
      const existing = manifest['uses-permission'].find((u) => u.$['android:name'] === p.name);
      if (existing) {
        // An earlier block (READ_MEDIA_* were blocked before this feature) must not remove what we need.
        delete existing.$['tools:node'];
        // Another library may ask for more (e.g. no max): keep the wider one.
        if (p.maxSdk && existing.$['android:maxSdkVersion'] && Number(existing.$['android:maxSdkVersion']) < Number(p.maxSdk)) {
          existing.$['android:maxSdkVersion'] = p.maxSdk;
        }
        continue;
      }
      manifest['uses-permission'].push({ $: { 'android:name': p.name, ...(p.maxSdk ? { 'android:maxSdkVersion': p.maxSdk } : {}) } });
    }
    const app = manifest.application?.[0];
    if (app) app.$['android:requestLegacyExternalStorage'] = 'true';
    return cfg;
  });
};
