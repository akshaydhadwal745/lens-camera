// Firebase Test Lab "game loop": Test Lab launches the main activity with
// com.google.intent.action.TEST_LOOP, and Lens runs its camera self-test
// (src/lib/self-test.ts). The intent filter is how Test Lab finds the entry.
const { withAndroidManifest } = require('expo/config-plugins');

const ACTION = 'com.google.intent.action.TEST_LOOP';

module.exports = function withTestLoop(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    const main = app?.activity?.find((a) => a.$['android:name'] === '.MainActivity');
    if (!main) return cfg;
    main['intent-filter'] = main['intent-filter'] ?? [];
    const has = main['intent-filter'].some((f) => f.action?.some((a) => a.$['android:name'] === ACTION));
    if (!has) {
      main['intent-filter'].push({
        action: [{ $: { 'android:name': ACTION } }],
        category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
        data: [{ $: { 'android:mimeType': 'application/javascript' } }],
      });
    }
    return cfg;
  });
};
