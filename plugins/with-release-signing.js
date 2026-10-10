// Release builds are signed with Lens's own key when CI provides it
// (LENS_KEYSTORE = path to the keystore, LENS_KEYSTORE_PASSWORD; alias "lens").
// Without them (local builds) the template's debug key is used, as before.
// The keystore lives only in infra/keys/android/ (gitignored) and GitHub
// secrets; docs/features/app-distribution.md explains backups.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// lens: release signing';

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARKER)) return cfg;
    // 1) buildTypes.release: use our key when CI provides it (before step 2 adds
    //    another "release {" block that a looser match could hit).
    const releaseUsesDebug = /(buildTypes \{[\s\S]*?\n(\s+)release \{[\s\S]*?)signingConfig signingConfigs\.debug/;
    if (!releaseUsesDebug.test(gradle)) throw new Error('with-release-signing: buildTypes.release signingConfig not found');
    gradle = gradle.replace(
      releaseUsesDebug,
      "$1signingConfig System.getenv('LENS_KEYSTORE') ? signingConfigs.release : signingConfigs.debug",
    );
    // 2) signingConfigs.release, read from the environment.
    const debugBlock = /signingConfigs \{\n(\s+)debug \{/;
    if (!debugBlock.test(gradle)) throw new Error('with-release-signing: signingConfigs block not found');
    gradle = gradle.replace(
      debugBlock,
      (match, indent) => `signingConfigs {
${indent}${MARKER}
${indent}release {
${indent}    if (System.getenv('LENS_KEYSTORE')) {
${indent}        storeFile file(System.getenv('LENS_KEYSTORE'))
${indent}        storePassword System.getenv('LENS_KEYSTORE_PASSWORD')
${indent}        keyAlias 'lens'
${indent}        keyPassword System.getenv('LENS_KEYSTORE_PASSWORD')
${indent}    }
${indent}}
${indent}debug {`,
    );
    cfg.modResults.contents = gradle;
    return cfg;
  });
};
