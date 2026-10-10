// Text and TextInput with the Lens fonts. Screens set fontWeight as usual and
// this picks the matching Geist file (Android can't synthesise weights from
// one custom file). A style that names its own fontFamily (e.g. the mono
// presets in lib/theme) is left alone.
import { forwardRef } from 'react';
import { Text as RNText, TextInput as RNTextInput, StyleSheet, type TextInputProps, type TextProps, type TextStyle } from 'react-native';

import { font } from '@/lib/theme';

function familyFor(weight: TextStyle['fontWeight']): string {
  switch (String(weight ?? '400')) {
    case '500':
      return font.medium;
    case '600':
      return font.semibold;
    case '700':
    case '800':
    case '900':
    case 'bold':
      return font.bold;
    default:
      return font.regular;
  }
}

function withFont<S>(style: S): (S | TextStyle)[] | S {
  const flat = StyleSheet.flatten(style as TextStyle) ?? {};
  if (flat.fontFamily) return style;
  return [style, { fontFamily: familyFor(flat.fontWeight), fontWeight: 'normal' }];
}

export const Text = forwardRef<RNText, TextProps>(function Text(props, ref) {
  return <RNText {...props} ref={ref} style={withFont(props.style)} />;
});

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput(props, ref) {
  return <RNTextInput {...props} ref={ref} style={withFont(props.style)} />;
});
/** So `useRef<TextInput>` keeps working where screens import this TextInput. */
// eslint-disable-next-line @typescript-eslint/no-redeclare
export type TextInput = RNTextInput;
// eslint-disable-next-line @typescript-eslint/no-redeclare
export type Text = RNText;
