// ML Kit models that Google Play services downloads at install time. Several
// libraries declare the same `com.google.mlkit.vision.DEPENDENCIES` entry with
// different values (expo-camera: barcode_ui; lens-camera: subject segmentation,
// scene labels, faces), which fails the manifest merge. The app's own manifest
// wins the merge, so the full list is declared here with tools:replace.
const { withAndroidManifest } = require('expo/config-plugins');

const NAME = 'com.google.mlkit.vision.DEPENDENCIES';
const MODELS = ['barcode_ui', 'subject_segment', 'ica', 'face'];

module.exports = function withMlkitModels(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] ?? 'http://schemas.android.com/tools';
    const app = manifest.application?.[0];
    if (!app) return cfg;
    app['meta-data'] = (app['meta-data'] ?? []).filter((m) => m.$['android:name'] !== NAME);
    app['meta-data'].push({ $: { 'android:name': NAME, 'android:value': MODELS.join(','), 'tools:replace': 'android:value' } });
    return cfg;
  });
};
