// Default Expo Metro config, plus one fallback path.
//
// expo-keep-awake ships inside expo (node_modules/expo/node_modules) and is
// already autolinked into the APK. Resolving it from there lets the app use it
// without a package-lock change, which would change the runtime version and
// need a new APK (see app.config.js). extraNodeModules is only a fallback, so a
// hoisted copy still wins once it's a direct dependency.
const path = require('node:path');
// Sentry's Expo config = Expo's default + debug IDs in bundles (source maps for crash reports).
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname);
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  'expo-keep-awake': path.join(__dirname, 'node_modules/expo/node_modules/expo-keep-awake'),
};

module.exports = config;
