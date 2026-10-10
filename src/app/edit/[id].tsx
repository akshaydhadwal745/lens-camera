import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isImagingAvailable, LensEditView, LensImaging } from '../../../modules/lens-camera';
import { ValueDial } from '@/components/pro/ValueDial';
import { posterUri } from '@/lib/derivatives';
import { cachedOriginal } from '@/lib/edit-remote';
import { ADJUSTMENTS, Adjustments, centeredCrop, compact, CROP_ASPECTS, EditRecipe, isNeutral, LOOKS } from '@/lib/edits';
import { asFileUri } from '@/lib/content-file';
import { uriFor } from '@/lib/local-store';
import { extensionFor } from '@/lib/storage/useOriginal';
import { nearestIndex } from '@/lib/pro-camera';
import { copyEdit, getState, saveEdit, selectGallery, useStore } from '@/lib/store';
import { colors, errorMessage, notify } from '@/lib/ui';

type Tab = 'looks' | 'adjust' | 'crop' | 'portrait';

const APERTURES = [1.4, 1.8, 2, 2.2, 2.8, 3.2, 4, 4.5, 5.6, 6.3, 8, 11, 16];
const STRAIGHTEN = Array.from({ length: 181 }, (_, i) => Math.round((i * 0.5 - 45) * 10) / 10);
const INTENSITY = Array.from({ length: 101 }, (_, i) => i / 100);

function range(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  for (let v = min; v <= max + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

function signed(v: number, digits = 0): string {
  const n = digits ? v.toFixed(digits) : String(Math.round(v * 100));
  return v > 0 ? `+${n}` : n;
}

export default function EditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const item = useStore((s) => selectGallery(s).find((g) => g.id === id));

  const [source, setSource] = useState<string | null>(null);
  const [baseThumb, setBaseThumb] = useState<{ uri: string; width: number; height: number } | null>(null);
  const [lookThumbs, setLookThumbs] = useState<Record<string, string>>({});
  const [depth, setDepth] = useState(false);
  const [recipe, setRecipe] = useState<EditRecipe>(item?.edit ?? {});
  const [tab, setTab] = useState<Tab>('looks');
  const [adjustKey, setAdjustKey] = useState<keyof Adjustments>('exposure');
  const [compare, setCompare] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load an unedited source: the original photo (local or cloud), or a video's poster frame.
  useEffect(() => {
    if (!item || !LensImaging) return;
    let cancelled = false;
    (async () => {
      const found = getState().entries.find((e) => e.id === item.id);
      // Offloaded entries only have previews here; photos edit from the cloud original.
      const entry = found?.offloadedAt || found?.awaitingCopy ? undefined : found;
      let uri: string;
      if (item.kind === 'video') {
        if (!entry) throw new Error('Video looks can be changed only while the video is still on the phone that recorded it.');
        uri = await posterUri(entry);
      } else {
        uri = entry
          ? uriFor(entry)
          : item.localUri?.startsWith('content:')
            ? await asFileUri(item.localUri, item.id, extensionFor(item.contentType, item.kind)) // imported: their gallery file
            : await cachedOriginal({
              id: item.id,
              url: item.remoteUrl,
              kind: item.kind,
              location: item.location,
              contentType: item.contentType,
            });
      }
      const base = await LensImaging!.renderImage(uri, null, { maxPixel: 320, format: 'jpeg', quality: 0.8 });
      const hasDepth = item.kind === 'photo' ? await LensImaging!.hasDepth(uri) : false;
      if (cancelled) return;
      setSource(uri);
      setBaseThumb(base);
      setDepth(hasDepth);
      // Small previews of every look.
      for (const look of LOOKS) {
        const r = await LensImaging!.renderImage(base.uri, { look: look.id }, { maxPixel: 160, format: 'jpeg', quality: 0.7 });
        if (cancelled) return;
        setLookThumbs((prev) => ({ ...prev, [look.id]: r.uri }));
      }
    })().catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (patch: Partial<EditRecipe>) => setRecipe((r) => ({ ...r, ...patch }));
  const setAdjust = (key: keyof Adjustments, value: number) =>
    setRecipe((r) => ({ ...r, adjust: { ...r.adjust, [key]: value } }));
  const setCrop = (patch: Partial<NonNullable<EditRecipe['crop']>>) =>
    setRecipe((r) => ({ ...r, crop: { ...r.crop, ...patch } }));

  const spec = ADJUSTMENTS.find((a) => a.key === adjustKey)!;
  const adjustValues = useMemo(() => range(spec.min, spec.max, spec.step), [spec]);
  const nativeRecipe = useMemo(() => compact(recipe), [recipe]);

  const save = async () => {
    if (!item) return;
    setSaving(true);
    try {
      await saveEdit(item.id, nativeRecipe);
      router.back();
    } catch (e) {
      notify('Could not save edit', errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (!isImagingAvailable) {
    return (
      <View style={[styles.fill, styles.center, { padding: 32 }]}>
        <Text style={styles.message}>Editing needs the Lens app build (it isn't available in Expo Go).</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={styles.link}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const imageRatio = baseThumb ? baseThumb.width / baseThumb.height : 1;
  const rotatedRatio = (recipe.crop?.rotate ?? 0) % 2 ? 1 / imageRatio : imageRatio;
  const tabs: { id: Tab; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
    { id: 'looks', label: 'Looks', icon: 'color-filter-outline' },
    { id: 'adjust', label: 'Adjust', icon: 'options-outline' },
    ...(item?.kind === 'photo' ? [{ id: 'crop' as Tab, label: 'Crop', icon: 'crop-outline' as const }] : []),
    ...(depth ? [{ id: 'portrait' as Tab, label: 'Portrait', icon: 'aperture-outline' as const }] : []),
  ];

  return (
    <View style={[styles.fill, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerButton}>
          <Text style={styles.headerText}>Cancel</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Pressable onPress={() => update({ auto: !recipe.auto })} style={[styles.pill, recipe.auto && styles.pillOn]}>
            <Ionicons name="sparkles" size={14} color={recipe.auto ? '#000' : '#fff'} />
            <Text style={[styles.pillText, recipe.auto && styles.pillTextOn]}>Auto</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              copyEdit(nativeRecipe ?? undefined);
              notify('Edit copied', 'Select photos in the gallery and tap "Paste edit".');
            }}
            disabled={!nativeRecipe}
            style={[styles.pill, !nativeRecipe && { opacity: 0.4 }]}
          >
            <Ionicons name="copy-outline" size={14} color="#fff" />
            <Text style={styles.pillText}>Copy</Text>
          </Pressable>
          <Pressable onPress={() => setRecipe({})} disabled={isNeutral(recipe)} style={[styles.pill, isNeutral(recipe) && { opacity: 0.4 }]}>
            <Ionicons name="refresh" size={14} color="#fff" />
            <Text style={styles.pillText}>Reset</Text>
          </Pressable>
        </View>
        <Pressable onPress={save} disabled={saving || !source} hitSlop={10} style={styles.headerButton}>
          {saving ? <ActivityIndicator color={colors.accent} /> : <Text style={[styles.headerText, styles.bold]}>Done</Text>}
        </Pressable>
      </View>

      {/* Press and hold to compare with the original. */}
      <Pressable style={styles.preview} onPressIn={() => setCompare(true)} onPressOut={() => setCompare(false)}>
        {source ? (
          <LensEditView
            style={StyleSheet.absoluteFill}
            uri={source}
            recipe={nativeRecipe}
            showOriginal={compare}
            onRenderError={(e) => setError(e.nativeEvent.message)}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.center]}>
            {error ? <Text style={styles.message}>{error}</Text> : <ActivityIndicator color="#fff" />}
          </View>
        )}
        {compare && <Text style={styles.compareBadge}>ORIGINAL</Text>}
      </Pressable>

      <View style={[styles.panel, { paddingBottom: insets.bottom + 8 }]}>
        {tab === 'looks' && (
          <>
            {recipe.look ? (
              <ValueDial
                title="INTENSITY"
                values={INTENSITY}
                index={nearestIndex(INTENSITY, recipe.intensity ?? 1)}
                label={(v) => `${Math.round(v * 100)}`}
                onIndex={(i) => update({ intensity: INTENSITY[i] })}
                auto={(recipe.intensity ?? 1) === 1}
                autoLabel="100"
                autoText="FULL"
                onAuto={() => update({ intensity: 1 })}
              />
            ) : (
              <Text style={styles.hint}>Pick a look. Your original is always kept — change or remove it any time.</Text>
            )}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.looks}>
              <Pressable onPress={() => update({ look: undefined, intensity: undefined })} style={styles.look}>
                <View style={[styles.lookThumb, !recipe.look && styles.lookThumbOn]}>
                  {baseThumb ? <Image source={{ uri: baseThumb.uri }} style={styles.lookImage} contentFit="cover" /> : null}
                </View>
                <Text style={[styles.lookName, !recipe.look && styles.lookNameOn]}>None</Text>
              </Pressable>
              {LOOKS.map((look) => (
                <Pressable key={look.id} onPress={() => update({ look: look.id })} style={styles.look} accessibilityLabel={look.description}>
                  <View style={[styles.lookThumb, recipe.look === look.id && styles.lookThumbOn]}>
                    {lookThumbs[look.id] ? (
                      <Image source={{ uri: lookThumbs[look.id] }} style={styles.lookImage} contentFit="cover" />
                    ) : null}
                  </View>
                  <Text style={[styles.lookName, recipe.look === look.id && styles.lookNameOn]}>{look.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}

        {tab === 'adjust' && (
          <>
            <ValueDial
              title={spec.label.toUpperCase()}
              values={adjustValues}
              index={nearestIndex(adjustValues, recipe.adjust?.[adjustKey] ?? 0)}
              label={(v) => (spec.key === 'exposure' ? `${signed(v, 1)} EV` : signed(v))}
              onIndex={(i) => setAdjust(adjustKey, adjustValues[i])}
              auto={!recipe.adjust?.[adjustKey]}
              autoLabel="0"
              autoText="RESET"
              onAuto={() => setAdjust(adjustKey, 0)}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {ADJUSTMENTS.map((a) => {
                const value = recipe.adjust?.[a.key] ?? 0;
                return (
                  <Pressable key={a.key} onPress={() => setAdjustKey(a.key)} style={[styles.chip, adjustKey === a.key && styles.chipOn]}>
                    <Text style={[styles.chipText, adjustKey === a.key && styles.chipTextOn]}>{a.label}</Text>
                    {value !== 0 && <View style={styles.dot} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        )}

        {tab === 'crop' && (
          <>
            <ValueDial
              title="STRAIGHTEN"
              values={STRAIGHTEN}
              index={nearestIndex(STRAIGHTEN, recipe.crop?.straighten ?? 0)}
              label={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}°`}
              onIndex={(i) => setCrop({ straighten: STRAIGHTEN[i] })}
              auto={!recipe.crop?.straighten}
              autoLabel="0°"
              autoText="RESET"
              onAuto={() => setCrop({ straighten: 0 })}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              <Pressable onPress={() => setCrop({ rotate: ((recipe.crop?.rotate ?? 0) + 1) % 4 })} style={styles.chip}>
                <Ionicons name="refresh-outline" size={14} color="#fff" />
                <Text style={styles.chipText}>Rotate</Text>
              </Pressable>
              <Pressable onPress={() => setCrop({ flip: !recipe.crop?.flip })} style={[styles.chip, recipe.crop?.flip && styles.chipOn]}>
                <Ionicons name="swap-horizontal" size={14} color={recipe.crop?.flip ? '#000' : '#fff'} />
                <Text style={[styles.chipText, recipe.crop?.flip && styles.chipTextOn]}>Flip</Text>
              </Pressable>
              {CROP_ASPECTS.map((a) => (
                <Pressable
                  key={a.id}
                  onPress={() => setCrop(centeredCrop(a.ratio, rotatedRatio, 1))}
                  style={styles.chip}
                >
                  <Text style={styles.chipText}>{a.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}

        {tab === 'portrait' && (
          <ValueDial
            title="BLUR (f-stop)"
            values={APERTURES}
            index={nearestIndex(APERTURES, recipe.portrait?.aperture ?? 2.8)}
            label={(v) => `f/${v}`}
            onIndex={(i) => update({ portrait: { aperture: APERTURES[i] } })}
            auto={!recipe.portrait?.aperture}
            autoLabel="Off"
            autoText="OFF"
            onAuto={() => update({ portrait: undefined })}
          />
        )}

        <View style={styles.tabs}>
          {tabs.map((t) => (
            <Pressable key={t.id} onPress={() => setTab(t.id)} style={styles.tab}>
              <Ionicons name={t.icon} size={20} color={tab === t.id ? colors.accent : '#A1A1A6'} />
              <Text style={[styles.tabText, tab === t.id && { color: colors.accent }]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center' },
  message: { color: '#E8E8ED', textAlign: 'center', fontSize: 15 },
  link: { color: colors.accent, fontSize: 16 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  headerButton: { minWidth: 60, minHeight: 44, justifyContent: 'center' },
  headerText: { color: colors.link, fontSize: 17 },
  bold: { fontWeight: '700', textAlign: 'right' },
  headerCenter: { flexDirection: 'row', gap: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#2C2C2E' },
  pillOn: { backgroundColor: colors.accent },
  pillText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  pillTextOn: { color: '#000' },
  preview: { flex: 1, backgroundColor: '#000' },
  compareBadge: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    color: '#000',
    backgroundColor: '#fff',
    fontWeight: '800',
    fontSize: 11,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  panel: { backgroundColor: '#0E0E10', paddingTop: 6 },
  hint: { color: '#86868B', fontSize: 13, paddingHorizontal: 16, paddingVertical: 10, textAlign: 'center' },
  looks: { paddingHorizontal: 12, gap: 10, paddingVertical: 8 },
  look: { alignItems: 'center', width: 68 },
  lookThumb: { width: 64, height: 64, borderRadius: 10, overflow: 'hidden', backgroundColor: '#2C2C2E', borderWidth: 2, borderColor: 'transparent' },
  lookThumbOn: { borderColor: colors.accent },
  lookImage: { width: '100%', height: '100%' },
  lookName: { color: '#A1A1A6', fontSize: 11, marginTop: 4 },
  lookNameOn: { color: colors.accent, fontWeight: '700' },
  chips: { paddingHorizontal: 12, gap: 8, paddingVertical: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: '#2C2C2E' },
  chipOn: { backgroundColor: colors.accent },
  chipText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: '#000' },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.accent, marginLeft: 2 },
  tabs: { flexDirection: 'row', justifyContent: 'space-around', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#2C2C2E', paddingTop: 8 },
  tab: { alignItems: 'center', minWidth: 64, minHeight: 44, justifyContent: 'center' },
  tabText: { color: '#A1A1A6', fontSize: 11, marginTop: 2 },
});
