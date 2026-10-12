// "Link a computer": scan the QR code shown on lens.instagrowapp.com/signin.
import { Ionicons } from '@expo/vector-icons';
import { BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/lib/api';
import { parsePersonCode, pickPerson } from '@/lib/person-code';
import { colors, errorMessage } from '@/lib/ui';

/** The sign-in QR encodes https://<site>/l/<session id>/. */
export function loginSessionFrom(data: string): string | null {
  const m = data.match(/\/l\/([A-Za-z0-9_-]{16,32})\/?$/);
  return m ? m[1] : null;
}

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);
  // ?for=person: the share screen wants a friend's "My Lens code" (exactly one person).
  const { for: purpose } = useLocalSearchParams<{ for?: string }>();
  const forPerson = purpose === 'person';
  const [message, setMessage] = useState<string | null>(null);

  const onScan = (result: BarcodeScanningResult) => {
    if (handled.current) return;
    if (forPerson) {
      const personId = parsePersonCode(result.data);
      if (!personId) {
        setMessage("That isn't a Lens code. Ask your friend for Settings → My Lens code.");
        return;
      }
      handled.current = true;
      api
        .lookupUser(personId)
        .then(({ user }) => {
          pickPerson(user);
          router.back();
        })
        .catch((error) => {
          handled.current = false;
          setMessage(errorMessage(error));
        });
      return;
    }
    const id = loginSessionFrom(result.data);
    if (!id) return;
    handled.current = true;
    router.replace({ pathname: '/l/[id]', params: { id } });
  };

  return (
    <View style={[styles.fill, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerButton} accessibilityLabel="Close">
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
        <Text style={styles.title}>{forPerson ? "Scan a friend's code" : 'Link a computer'}</Text>
        <View style={styles.headerButton} />
      </View>
      {permission?.granted ? (
        <View style={styles.cameraWrap}>
          <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScan} />
          <View style={styles.frame} pointerEvents="none" />
        </View>
      ) : (
        <View style={[styles.cameraWrap, styles.center]}>
          <Pressable
            style={styles.button}
            onPress={() => (permission?.canAskAgain === false ? Linking.openSettings() : requestPermission())}
          >
            <Text style={styles.buttonText}>Allow camera</Text>
          </Pressable>
        </View>
      )}
      <View style={[styles.help, { paddingBottom: insets.bottom + 16 }]}>
        {forPerson ? (
          <Text style={styles.helpText}>
            {message ?? 'Ask your friend to open Settings → My Lens code, then point your camera at it.'}
          </Text>
        ) : (
          <Text style={styles.helpText}>
            On your computer, open <Text style={styles.bold}>lens.instagrowapp.com</Text> and click Sign in. Point your phone at the QR code.
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  headerButton: { width: 44, height: 44, justifyContent: 'center' },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  cameraWrap: { flex: 1, margin: 16, borderRadius: 20, overflow: 'hidden', backgroundColor: '#1C1C1E' },
  frame: { position: 'absolute', top: '20%', left: '15%', right: '15%', aspectRatio: 1, borderWidth: 3, borderColor: '#FACC15', borderRadius: 16 },
  button: { backgroundColor: colors.action, borderRadius: 24, paddingHorizontal: 24, paddingVertical: 12 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  help: { paddingHorizontal: 24 },
  helpText: { color: '#E8E8ED', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  bold: { fontWeight: '700', color: '#fff' },
});
