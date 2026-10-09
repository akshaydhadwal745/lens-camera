// "Link a computer": scan the QR code shown on lens.instagrowapp.com/signin.
import { Ionicons } from '@expo/vector-icons';
import { BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useRef } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@/lib/ui';

/** The sign-in QR encodes https://<site>/l/<session id>/. */
export function loginSessionFrom(data: string): string | null {
  const m = data.match(/\/l\/([A-Za-z0-9_-]{16,32})\/?$/);
  return m ? m[1] : null;
}

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);

  const onScan = (result: BarcodeScanningResult) => {
    if (handled.current) return;
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
        <Text style={styles.title}>Link a computer</Text>
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
        <Text style={styles.helpText}>
          On your computer, open <Text style={styles.bold}>lens.instagrowapp.com</Text> and click Sign in. Point your phone at the QR code.
        </Text>
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
  cameraWrap: { flex: 1, margin: 16, borderRadius: 20, overflow: 'hidden', backgroundColor: '#111' },
  frame: { position: 'absolute', top: '20%', left: '15%', right: '15%', aspectRatio: 1, borderWidth: 3, borderColor: colors.accent, borderRadius: 16 },
  button: { backgroundColor: colors.accent, borderRadius: 24, paddingHorizontal: 24, paddingVertical: 12 },
  buttonText: { color: '#000', fontWeight: '700', fontSize: 16 },
  help: { paddingHorizontal: 24 },
  helpText: { color: '#ccc', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  bold: { fontWeight: '700', color: '#fff' },
});
