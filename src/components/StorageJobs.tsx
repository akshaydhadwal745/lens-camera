// Settings → Storage: "Move to my Google Drive" (paid above the free allowance; infra/lambda/api/drive-move.ts)
// and "Download everything" (free ZIPs; infra/lambda/api/export.ts). Both run on Lens's side, so the
// phone can be off; we tell them when it's done.
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { api, ExportStatus, MoveStatus } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { playBillingHere, razorpayHere, rupees } from '@/lib/pay-channel';
import { buyMovePack, movePackPrices, MOVE_PACKS, packsFor } from '@/lib/play-billing';
import { loadSaved } from '@/lib/storage/vault';
import { refreshStorage } from '@/lib/store';
import { ConnectedStorage } from '@/lib/types';
import { colors, confirmDestructive, errorMessage, notify } from '@/lib/ui';
import { track } from '@/lib/usage';

const day = (t?: number) => (t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');

async function openPage(url: string) {
  if (Platform.OS === 'web') window.open(url, '_blank', 'noopener');
  else await WebBrowser.openBrowserAsync(url, { showTitle: true });
}

/** Polls while something runs on our side; refreshes when the app comes back to the front. */
function usePoll<T>(load: () => Promise<T>, active: (v: T | null) => boolean) {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async () => {
    try {
      const v = await load();
      setValue(v);
      setError(null);
      return v;
    } catch (e) {
      setError(errorMessage(e));
      return null;
    }
  }, [load]);
  useEffect(() => {
    const t = setTimeout(() => void run(), 0);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void run());
    return () => {
      clearTimeout(t);
      sub.remove();
    };
  }, [run]);
  const on = active(value);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => void run(), 10_000);
    return () => clearInterval(t);
  }, [on, run]);
  return { value, setValue, error, run };
}

export function MoveToDrive({ drive }: { drive: ConnectedStorage }) {
  const waitingPay = useRef(false);
  const load = useCallback(() => (waitingPay.current ? api.moveRefresh() : api.move()), []);
  const { value: s, setValue, error, run } = usePoll<MoveStatus>(load, (v) => v?.job?.status === 'running' || v?.job?.status === 'awaiting-payment');
  const [busy, setBusy] = useState(false);
  const job = s?.job;
  const q = s?.quote;
  const freeSpace = drive.totalBytes !== undefined && drive.usedBytes !== undefined ? drive.totalBytes - drive.usedBytes : undefined;

  useEffect(() => {
    if (job?.status === 'done') void refreshStorage();
    if (job?.status !== 'awaiting-payment') waitingPay.current = false;
  }, [job?.status]);

  const start = async () => {
    if (!q || busy) return;
    if (Platform.OS === 'web') {
      notify('Use the Lens app', 'Moving needs your Google Drive sign-in, which stays on your phone. Open Lens on your phone → Settings → Storage.');
      return;
    }
    if (q.pricePaise > 0 && !razorpayHere && !playBillingHere) {
      notify('Not available in this version yet', 'Moving more than the free amount is coming soon.');
      return;
    }
    // Play Store app: buy move credit through Google Play first (packs of 25 / 100 GB at ₹15 a GB);
    // with the credit on the account the move itself costs nothing more.
    if (q.pricePaise > 0 && playBillingHere) {
      if (!(await buyPlayCredit(q.payGb))) return;
      const fresh = await api.move();
      setValue(fresh);
      if (fresh.quote.pricePaise > 0) {
        notify('Almost there', 'Google Play confirmed the payment, but the credit hasn’t arrived yet. Try again in a minute.');
        return;
      }
      return startNow(fresh);
    }
    return startNow(s!);
  };

  /** Google Play: the packs covering `gb`, one Google sheet each. False if they stopped. */
  const buyPlayCredit = async (gb: number) => {
    const packs = packsFor(gb);
    const prices = await movePackPrices().catch(() => ({}) as Record<string, string>);
    const total = packs.reduce((n, p) => n + MOVE_PACKS[p], 0);
    const list = packs.map((p) => `${MOVE_PACKS[p]} GB${prices[p] ? ` (${prices[p]})` : ''}`).join(' + ');
    const ok = await confirmDestructive(
      `Move ${gb} GB above the free amount?`,
      `Moving costs ₹15 per GB above the free ${formatBytes(q!.freeBytes)} (it covers the internet transfer). You buy move credit in Google Play: ${list}. Unused credit stays for your next move.`,
      packs.length > 1 ? `Buy ${total} GB of credit` : `Buy ${total} GB · ${prices[packs[0]] ?? rupees(total * 1_500)}`,
    );
    if (!ok) return false;
    const status = await api.play();
    setBusy(true);
    try {
      for (const p of packs) await buyMovePack(p, status);
      track(`move_play_credit_${total}`);
      return true;
    } catch (e) {
      if (!(e as { cancelled?: boolean }).cancelled) notify('Couldn’t finish the payment', errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const startNow = async (current: MoveStatus) => {
    const q = current.quote;
    const price = q.pricePaise > 0 ? `${rupees(q.pricePaise)} (${q.payGb} GB above the free ${formatBytes(q.freeLeftBytes + q.creditBytes)})` : 'Free';
    const ok = await confirmDestructive(
      `Move ${q.items} items to Google Drive?`,
      `${formatBytes(q.bytes)} of originals go to the Lens folder in your Google Drive, then leave Lens storage. Lens keeps the previews, so your gallery looks the same. Cost: ${price}.`,
      q.pricePaise > 0 ? `Pay ${rupees(q.pricePaise)} and move` : 'Move',
    );
    if (!ok) return;
    setBusy(true);
    try {
      const saved = await loadSaved(drive.id);
      if (!saved?.refreshToken) throw new Error('Sign in to Google Drive again on this phone (Your storage → Sign in again), then try once more.');
      const r = await api.startMove({ storageId: drive.id, refreshToken: saved.refreshToken, folderId: saved.config.folderId });
      setValue({ quote: q, job: r.job });
      track(q.pricePaise > 0 ? 'move_paid_start' : 'move_free_start');
      if (r.job.payUrl) {
        waitingPay.current = true;
        await openPage(r.job.payUrl);
        await run();
      }
    } catch (e) {
      notify('Couldn’t start moving', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    const ok = await confirmDestructive('Stop moving?', 'What’s moved stays in your Google Drive; the rest stays in Lens. Paid space you didn’t use is kept for next time.', 'Stop');
    if (!ok) return;
    try {
      setValue(await api.moveCancel());
    } catch (e) {
      notify('Couldn’t stop', errorMessage(e));
    }
  };

  if (!s) return <View style={styles.pad}>{error ? <Text style={styles.muted}>{error}</Text> : <ActivityIndicator color="#fff" />}</View>;

  if (job?.status === 'running' || job?.status === 'awaiting-payment') {
    const pct = job.totalBytes ? Math.min(100, (job.movedBytes / job.totalBytes) * 100) : 0;
    return (
      <View style={styles.pad}>
        <Text style={styles.head}>{job.status === 'running' ? 'Moving to your Google Drive…' : 'Waiting for your payment'}</Text>
        {job.status === 'running' ? (
          <>
            <View style={styles.bar}>
              <View style={{ width: `${pct}%`, backgroundColor: colors.link }} />
            </View>
            <Text style={styles.muted}>
              {job.movedItems} of {job.totalItems} · {formatBytes(job.movedBytes)} of {formatBytes(job.totalBytes)}. You can close Lens: we tell you when it’s done.
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.muted}>{rupees(job.pricePaise)} on Razorpay’s page. Moving starts as soon as it’s paid.</Text>
            {job.payUrl && (
              <Pressable style={styles.small} onPress={() => { waitingPay.current = true; void openPage(job.payUrl!); }}>
                <Text style={styles.smallText}>Open payment page</Text>
              </Pressable>
            )}
          </>
        )}
        <Pressable onPress={cancel} hitSlop={8}>
          <Text style={[styles.link, { color: colors.danger }]}>{job.status === 'running' ? 'Stop' : 'Cancel'}</Text>
        </Pressable>
      </View>
    );
  }

  const last =
    job?.status === 'done'
      ? `Last move: ${job.movedItems} items (${formatBytes(job.movedBytes)}) on ${day(job.finishedAt)}.${job.reason === 'allowance' ? ' Newer photos stayed in Lens.' : ''}`
      : job?.status === 'paused'
        ? job.reason === 'drive-full'
          ? `Stopped: your Google Drive is full (${job.movedItems} moved). Free up space there, then continue.`
          : job.reason === 'signed-out'
            ? `Stopped: sign in to Google Drive again (${job.movedItems} moved), then continue.`
            : `Stopped after ${job.movedItems} items. Continue to try again.`
        : null;

  return (
    <View style={styles.pad}>
      {q && q.items > 0 ? (
        <>
          <Text style={styles.head}>
            {q.items} items · {formatBytes(q.bytes)} in Lens storage
          </Text>
          <Text style={styles.muted}>
            Move your originals to the Lens folder in your Google Drive and free up Lens storage. Lens keeps the previews, so nothing changes in your gallery.
            Items you shared stay in Lens, so friends keep the full quality.
          </Text>
          <Text style={styles.price}>
            {q.pricePaise > 0 ? `${rupees(q.pricePaise)} for this move` : 'Free'}
            <Text style={styles.muted}>
              {' '}
              · first {formatBytes(q.freeBytes)} free, then {rupees(q.pricePerGbPaise)} per GB (it covers the internet transfer).
            </Text>
          </Text>
          {freeSpace !== undefined && freeSpace < q.bytes && (
            <Text style={[styles.muted, { color: '#FACC15' }]}>Your Google Drive has {formatBytes(Math.max(0, freeSpace))} free: moving stops when it’s full.</Text>
          )}
          {last && <Text style={styles.muted}>{last}</Text>}
          <Pressable style={[styles.button, busy && { opacity: 0.6 }]} onPress={start} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{job?.status === 'paused' ? 'Continue moving' : 'Move to Google Drive'}</Text>}
          </Pressable>
        </>
      ) : (
        <Text style={styles.muted}>{last ?? 'Nothing to move: your originals are already in your Google Drive.'}</Text>
      )}
    </View>
  );
}

export function DownloadEverything() {
  const load = useCallback(() => api.exportStatus().then((r) => r.export ?? null), []);
  const { value: x, setValue, error } = usePoll<ExportStatus | null>(load, (v) => v?.status === 'building');
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());
  const start = async () => {
    setBusy(true);
    try {
      setValue((await api.startExport()).export ?? null);
      track('export_start');
    } catch (e) {
      notify('Couldn’t start', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const canStart = !x || (x.status !== 'building' && now >= x.nextAllowedAt);
  return (
    <View style={styles.pad}>
      {x?.status === 'building' ? (
        <>
          <Text style={styles.head}>Preparing your download…</Text>
          <Text style={styles.muted}>
            {x.doneItems} of {x.totalItems} items packed ({formatBytes(x.totalBytes)}). We send you a notification and an email when it’s ready.
          </Text>
        </>
      ) : x?.status === 'ready' ? (
        <>
          <Text style={styles.head}>Ready until {day(x.expiresAt)}</Text>
          {x.files.map((f) => (
            <Pressable key={f.url} style={styles.file} onPress={() => (Platform.OS === 'web' ? window.open(f.url, '_blank', 'noopener') : Linking.openURL(f.url))}>
              <Ionicons name="download-outline" size={18} color={colors.link} />
              <Text style={[styles.muted, { flex: 1, color: '#fff' }]}>{f.name}</Text>
              <Text style={styles.muted}>{formatBytes(f.bytes)}</Text>
            </Pressable>
          ))}
          <Text style={styles.muted}>ZIP files, photos in folders by year. On a computer: lens.instagrowapp.com/app/storage.</Text>
        </>
      ) : (
        <>
          <Text style={styles.muted}>
            Get a copy of every original in Lens storage as ZIP files, free. Takes from minutes to a few hours; links work for 6 days.
            {x?.status === 'failed' ? ' The last try failed: start again.' : ''}
          </Text>
          {error && <Text style={styles.muted}>{error}</Text>}
          {canStart ? (
            <Pressable style={[styles.button, busy && { opacity: 0.6 }]} onPress={start} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Download everything</Text>}
            </Pressable>
          ) : (
            <Text style={styles.muted}>You can make a new download on {day(x?.nextAllowedAt)}.</Text>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16, gap: 10 },
  head: { color: '#fff', fontSize: 16, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  price: { color: '#fff', fontSize: 15, fontWeight: '700', lineHeight: 20 },
  bar: { height: 8, borderRadius: 4, backgroundColor: '#2C2C2E', overflow: 'hidden', flexDirection: 'row' },
  button: { backgroundColor: colors.action, borderRadius: 980, minHeight: 46, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  small: { backgroundColor: '#2C2C2E', borderRadius: 10, paddingHorizontal: 14, minHeight: 36, justifyContent: 'center', alignSelf: 'flex-start' },
  smallText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  link: { color: colors.link, fontSize: 14, fontWeight: '600' },
  file: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 },
});
