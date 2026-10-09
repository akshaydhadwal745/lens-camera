// One APK per CPU type instead of one APK for all: 32-bit phones (many Android
// Go / older budget phones) get a small APK of their own, and 64-bit phones
// don't carry 32-bit code. Builds whatever -PreactNativeArchitectures lists.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// lens: abi splits';

module.exports = function withAbiSplits(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.contents.includes(MARKER)) return cfg;
    cfg.modResults.contents = cfg.modResults.contents.replace(
      /^android \{\n/m,
      `android {
    ${MARKER}
    splits {
        abi {
            enable true
            reset()
            include(*((findProperty('reactNativeArchitectures') ?: 'arm64-v8a').split(',').collect { it.trim() }))
            universalApk false
        }
    }
`,
    );
    return cfg;
  });
};
