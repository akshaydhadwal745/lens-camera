// Lens design language for the app (docs/design/app-design.md), matching the
// website's "Keynote" look. One source for colours, fonts, radii and glass.
//
// - Geist for all text; IBM Plex Mono for data (frame numbers, camera
//   readouts, photo details, build label).
// - Yellow = Lens doing something smart or active (Night, selected mode,
//   today); blue = actions, links, storage; green = safe in the cloud;
//   red = recording, delete.
// - Glass only where controls float over a photo or the viewfinder; solid
//   surfaces everywhere else.

export const palette = {
  bg: '#000000',
  surface: '#1C1C1E',
  surface2: '#2C2C2E',
  surface3: '#3A3A3C',
  hairline: '#1D1D1F',
  text: '#F5F5F7',
  soft: '#E8E8ED',
  muted: '#A1A1A6',
  dim: '#86868B',
  accent: '#FACC15',
  link: '#2997FF',
  action: '#0071E3',
  safe: '#30D158',
  cloud: '#64D2FF',
  danger: '#FF453A',
  rec: '#FF3B30',
} as const;

/** Font family names, as loaded in app/_layout.tsx (assets/fonts). */
export const font = {
  regular: 'Geist-Regular',
  medium: 'Geist-Medium',
  semibold: 'Geist-SemiBold',
  bold: 'Geist-Bold',
  mono: 'IBMPlexMono-Regular',
  monoMedium: 'IBMPlexMono-Medium',
  monoSemibold: 'IBMPlexMono-SemiBold',
} as const;

export const fontFiles = {
  [font.regular]: require('../../assets/fonts/Geist-Regular.ttf'),
  [font.medium]: require('../../assets/fonts/Geist-Medium.ttf'),
  [font.semibold]: require('../../assets/fonts/Geist-SemiBold.ttf'),
  [font.bold]: require('../../assets/fonts/Geist-Bold.ttf'),
  [font.mono]: require('../../assets/fonts/IBMPlexMono-Regular.ttf'),
  [font.monoMedium]: require('../../assets/fonts/IBMPlexMono-Medium.ttf'),
  [font.monoSemibold]: require('../../assets/fonts/IBMPlexMono-SemiBold.ttf'),
};

export const radius = { tile: 16, card: 20, sheet: 28, bar: 34, pill: 999 } as const;

/** Controls floating over a photo or the viewfinder. */
export const glass = {
  backgroundColor: 'rgba(22,22,24,0.66)',
  borderColor: 'rgba(255,255,255,0.14)',
  borderWidth: 1,
} as const;

/** Text styles used across screens. */
export const type = {
  largeTitle: { fontFamily: font.bold, fontSize: 34, letterSpacing: -1, color: palette.text },
  title: { fontFamily: font.bold, fontSize: 22, letterSpacing: -0.5, color: palette.text },
  headline: { fontFamily: font.semibold, fontSize: 17, color: palette.text },
  body: { fontFamily: font.regular, fontSize: 16, color: palette.text },
  caption: { fontFamily: font.regular, fontSize: 13, color: palette.muted },
  /** Small capital data label, e.g. "2 412 FRAMES · ALL SAFE". */
  monoLabel: { fontFamily: font.monoMedium, fontSize: 11, letterSpacing: 1.3, color: palette.muted },
} as const;
