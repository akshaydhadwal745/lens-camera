// Android: what this phone's cameras can do, as Lens detected it. Helps explain
// why a feature is or isn't offered, and can be shared for support.
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cameraDeviceReport } from '../../modules/lens-camera';
import { colors, errorMessage } from '@/lib/ui';

type Camera = {
  id: string;
  facing: string;
  level: string;
  capabilities: string[];
  megapixels: number;
  fovDegrees?: number;
  iso?: string;
  shutter?: string;
  minFocusCm?: number;
  awbPresets: string[];
  flash: boolean;
  ois: boolean;
  zoomRatio?: string;
  fps?: string[];
  videoQualities?: string[];
  hdrVideo?: string[];
  extensions?: string[] | null;
  camera2Extensions?: string[] | null;
  noiseReductionModes?: string[];
  streams?: Record<string, { size: string; maxFps: number | null; stallMs: number } | null> | null;
};

type Report = {
  device: { manufacturer: string; model: string; android: string; api: number; abis: string[]; ramGB: number; lowRam: boolean };
  tier: string;
  lenses: { id: string; factor: number; via: string }[];
  cameras: Camera[];
};

const TIER_TEXT: Record<string, string> = {
  pro: 'Pro: manual ISO, shutter, white balance and focus',
  standard: 'Standard: auto with exposure control; manual where supported',
  basic: 'Basic: automatic camera with exposure control',
  none: 'No camera found',
};

export default function CameraInfoScreen() {
  const insets = useSafeAreaInsets();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    cameraDeviceReport()
      .then((r) => (r ? setReport(r as Report) : setError('Not available on this device.')))
      .catch((e) => setError(errorMessage(e)));
  }, []);

  return (
    <View style={[styles.fill, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerButton}>
          <Text style={styles.headerText}>Close</Text>
        </Pressable>
        <Text style={styles.title}>Camera info</Text>
        <Pressable
          onPress={() => report && Share.share({ message: JSON.stringify(report, null, 1) })}
          disabled={!report}
          hitSlop={10}
          style={[styles.headerButton, { alignItems: 'flex-end' }]}
        >
          <Ionicons name="share-outline" size={20} color={report ? colors.link : '#636366'} />
        </Pressable>
      </View>
      {!report ? (
        <View style={[styles.fill, styles.center]}>
          {error ? <Text style={styles.muted}>{error}</Text> : <ActivityIndicator color="#fff" />}
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
          <Text style={styles.device}>
            {report.device.manufacturer} {report.device.model}
          </Text>
          <Text style={styles.muted}>
            Android {report.device.android} (API {report.device.api}) · {report.device.ramGB} GB RAM{report.device.lowRam ? ' · low-RAM' : ''} ·{' '}
            {report.device.abis[0]}
          </Text>
          <View style={styles.card}>
            <Text style={styles.label}>Camera level</Text>
            <Text style={styles.value}>{TIER_TEXT[report.tier] ?? report.tier}</Text>
            {report.lenses.length > 0 && (
              <>
                <Text style={[styles.label, { marginTop: 10 }]}>Back lenses</Text>
                <Text style={styles.value}>{report.lenses.map((l) => `${l.factor}× (${l.id})`).join(' · ')}</Text>
              </>
            )}
          </View>
          {report.cameras.map((c) => (
            <View key={c.id} style={styles.card}>
              <Text style={styles.cameraTitle}>
                {c.facing === 'back' ? 'Back' : c.facing === 'front' ? 'Front' : 'External'} camera {c.id} · {c.level}
              </Text>
              <Line label="Sensor" value={`${c.megapixels} MP${c.fovDegrees ? ` · ${c.fovDegrees}° view` : ''}${c.ois ? ' · OIS' : ''}`} />
              {c.iso ? <Line label="ISO" value={c.iso} /> : null}
              {c.shutter ? <Line label="Shutter" value={c.shutter} /> : null}
              <Line label="Focus" value={c.minFocusCm ? `down to ${c.minFocusCm} cm` : 'fixed'} />
              {c.zoomRatio ? <Line label="Zoom" value={c.zoomRatio} /> : null}
              {c.videoQualities?.length ? <Line label="Video" value={c.videoQualities.join(', ')} /> : null}
              {c.hdrVideo?.length ? <Line label="HDR video" value={c.hdrVideo.join(', ')} /> : null}
              {c.fps?.length ? <Line label="Frame rates" value={c.fps.join(', ')} /> : null}
              {c.awbPresets.length ? <Line label="White balance" value={c.awbPresets.join(', ')} /> : null}
              <Line label="Features" value={c.capabilities.join(', ').toLowerCase().replace(/_/g, ' ')} />
              <Line label="Maker modes" value={c.extensions?.length ? c.extensions.join(', ') : 'none'} />
              {c.noiseReductionModes?.length ? <Line label="Noise reduction" value={c.noiseReductionModes.join(', ')} /> : null}
              {c.streams
                ? Object.entries(c.streams)
                    .filter(([, v]) => v)
                    .map(([k, v]) => <Line key={k} label={k.toUpperCase()} value={`${v!.size}${v!.maxFps ? ` · up to ${v!.maxFps} fps` : ''}`} />)
                : null}
            </View>
          ))}
          <Pressable style={styles.lab} onPress={() => router.push('/selftest')}>
            <Ionicons name="checkmark-done-outline" size={18} color={colors.link} />
            <Text style={styles.labText}>Run self-test</Text>
          </Pressable>
          <Pressable style={styles.lab} onPress={() => router.push('/lab')}>
            <Ionicons name="flask-outline" size={18} color={colors.link} />
            <Text style={styles.labText}>Quality Lab</Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  headerButton: { minWidth: 60, minHeight: 44, justifyContent: 'center' },
  headerText: { color: colors.link, fontSize: 17 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  device: { color: '#fff', fontSize: 20, fontWeight: '700' },
  muted: { color: '#86868B', fontSize: 13, marginTop: 4 },
  card: { backgroundColor: '#1C1C1E', borderRadius: 20, padding: 14, marginTop: 14 },
  label: { color: '#86868B', fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  value: { color: '#fff', fontSize: 15, marginTop: 3 },
  cameraTitle: { color: '#fff', fontSize: 15, fontWeight: '700', marginBottom: 6 },
  line: { flexDirection: 'row', paddingVertical: 3 },
  lineLabel: { color: '#86868B', fontSize: 13, width: 100 },
  lineValue: { color: '#E8E8ED', fontSize: 13, flex: 1 },
  lab: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: '#1C1C1E' },
  labText: { color: colors.link, fontSize: 15, fontWeight: '600' },
});
