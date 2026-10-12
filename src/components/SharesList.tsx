// Share requests: what people want to share with you (Requests) and what you
// shared (Sent). Nothing reaches your Shared tab until you accept; what you sent
// can be cancelled while it's waiting and revoked after (docs/design/sharing-consent.md).
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { api, ShareRequest, ShareStatus } from '@/lib/api';
import { askForNotifications } from '@/lib/push';
import { palette } from '@/lib/theme';
import { colors, confirmDestructive, errorMessage, notify } from '@/lib/ui';

export const STATUS_LABEL: Record<ShareStatus, string> = {
  pending: 'Waiting',
  accepted: 'Accepted',
  declined: 'Declined',
  cancelled: 'Cancelled',
  revoked: 'Revoked',
  expired: 'Expired',
};

export function whatText(r: Pick<ShareRequest, 'photos' | 'videos'>): string {
  const parts = [r.photos ? `${r.photos} photo${r.photos === 1 ? '' : 's'}` : '', r.videos ? `${r.videos} video${r.videos === 1 ? '' : 's'}` : ''].filter(Boolean);
  return parts.join(' and ') || 'items';
}

function ago(ms: number, now: number): string {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function SharesList({ initial }: { initial: 'in' | 'out' }) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'in' | 'out'>(initial);
  const [items, setItems] = useState<ShareRequest[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // "expires in" / "ago" use the time of the last load (render stays pure).
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const r = tab === 'in' ? await api.sharesIn() : await api.sharesOut();
      setNow(Date.now());
      setItems(r.requests);
    } catch (error) {
      setItems([]);
      notify('Could not load', errorMessage(error));
    }
  }, [tab]);

  // Share requests arrive as notifications: ask once here, where it obviously helps.
  useEffect(() => {
    void askForNotifications();
  }, []);

  useEffect(() => {
    let alive = true;
    (tab === 'in' ? api.sharesIn() : api.sharesOut()).then(
      (r) => {
        if (!alive) return;
        setNow(Date.now());
        setItems(r.requests);
      },
      (error) => {
        if (!alive) return;
        setItems([]);
        notify('Could not load', errorMessage(error));
      },
    );
    return () => {
      alive = false;
    };
  }, [tab]);

  const switchTab = (t: 'in' | 'out') => {
    if (t === tab) return;
    setItems(null);
    setTab(t);
  };

  const takeBack = async (r: ShareRequest) => {
    const revoke = r.status === 'accepted';
    const ok = await confirmDestructive(
      revoke ? `Revoke from ${r.to.name}?` : `Cancel share to ${r.to.name}?`,
      revoke ? `${r.to.name} loses access to the ${whatText(r)} right away.` : `${r.to.name} won't be able to accept it.`,
      revoke ? 'Revoke' : 'Cancel share',
    );
    if (!ok) return;
    setBusy(r.shareId);
    try {
      await api.cancelShare(r.shareId);
      await load();
    } catch (error) {
      notify('Could not change it', errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={[styles.fill, { paddingTop: insets.top || 12 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerButton} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={colors.link} />
        </Pressable>
        <Text style={styles.title}>Sharing</Text>
        <View style={styles.headerButton} />
      </View>
      <View style={styles.tabs}>
        {(
          [
            ['in', 'Requests'],
            ['out', 'Sent'],
          ] as const
        ).map(([t, label]) => (
          <Pressable key={t} onPress={() => switchTab(t)} style={[styles.tab, tab === t && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === t }}>
            <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {items === null ? (
        <ActivityIndicator color={palette.text} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r) => r.shareId}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor="#fff" />}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {tab === 'in' ? 'No share requests. When someone shares with you, you can preview and accept it here.' : "You haven't shared anything yet."}
            </Text>
          }
          renderItem={({ item: r }) => {
            const person = tab === 'in' ? r.from : r.to;
            const waiting = r.status === 'pending';
            return (
              <Pressable
                style={styles.row}
                disabled={tab !== 'in'}
                onPress={() => router.push({ pathname: '/shares/[id]', params: { id: r.shareId } })}
                accessibilityRole={tab === 'in' ? 'button' : undefined}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>
                    {tab === 'in' ? `${person.name} wants to share ${whatText(r)}` : `${whatText(r)} to ${person.name}`}
                  </Text>
                  <Text style={styles.meta}>
                    {person.account ? 'Signed-in account' : 'Guest phone'} · {ago(r.createdAt, now)}
                    {waiting && tab === 'in' ? ` · expires in ${Math.max(1, Math.ceil((r.expiresAt - now) / 86400000))} d` : ''}
                  </Text>
                </View>
                <Text style={[styles.status, waiting && styles.statusWaiting]}>{STATUS_LABEL[r.status]}</Text>
                {tab === 'in' && waiting ? <Ionicons name="chevron-forward" size={18} color="#636366" /> : null}
                {tab === 'out' && (r.status === 'pending' || r.status === 'accepted') ? (
                  <Pressable onPress={() => void takeBack(r)} disabled={busy === r.shareId} hitSlop={8} style={styles.action}>
                    {busy === r.shareId ? <ActivityIndicator color={colors.link} /> : <Text style={styles.actionText}>{r.status === 'pending' ? 'Cancel' : 'Revoke'}</Text>}
                  </Pressable>
                ) : null}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 52 },
  headerButton: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 980, backgroundColor: '#1C1C1E' },
  tabOn: { backgroundColor: '#fff' },
  tabText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  tabTextOn: { color: '#000' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2C2C2E' },
  name: { color: '#fff', fontSize: 15, fontWeight: '600' },
  meta: { color: '#86868B', fontSize: 12, marginTop: 3 },
  status: { color: '#86868B', fontSize: 13 },
  statusWaiting: { color: palette.accent, fontWeight: '600' },
  action: { minWidth: 64, alignItems: 'flex-end' },
  actionText: { color: colors.link, fontSize: 15 },
  empty: { color: '#86868B', fontSize: 14, lineHeight: 20, padding: 24, textAlign: 'center' },
});
