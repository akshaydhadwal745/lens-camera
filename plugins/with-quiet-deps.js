// CI logs had ~135 compiler warnings per Android build, all but a handful from
// libraries in node_modules (react-native-screens, reanimated, Expo modules,
// netinfo…) that we can't change. They buried our own warnings. This silences
// compiler warnings ONLY for projects under node_modules; Lens's own code
// (modules/, the app) keeps every warning, so a new one of ours stands out.
const { withProjectBuildGradle } = require('expo/config-plugins');

const MARKER = '// lens: quiet third-party compiler warnings';

const BLOCK = `
${MARKER} (plugins/with-quiet-deps.js)
subprojects { p ->
  if (p.projectDir.absolutePath.contains("\${File.separator}node_modules\${File.separator}")) {
    p.plugins.withId('org.jetbrains.kotlin.android') {
      p.tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile).configureEach {
        compilerOptions.suppressWarnings.set(true)
      }
    }
    p.plugins.withId('java-base') {
      p.tasks.withType(JavaCompile).configureEach {
        options.warnings = false
        options.compilerArgs += ['-nowarn', '-Xlint:none', '-Xlint:-removal', '-Xlint:-deprecation']
      }
    }
  }
}
`;

module.exports = function withQuietDeps(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes(MARKER)) cfg.modResults.contents += BLOCK;
    return cfg;
  });
};
module.exports.BLOCK = BLOCK;
