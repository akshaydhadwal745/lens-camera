// Website: "Upload" button + drag & drop anywhere on the page. Files go up one
// at a time (each in parallel parts) with progress; the gallery refreshes as
// each one lands. Leaving the page mid-upload asks for confirmation.
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';

import { refreshRemote } from '@/lib/store';
import { colors, errorMessage } from '@/lib/ui';
import { ACCEPT, typeOf, uploadFile, UploadJob } from '@/lib/web-upload';

export function WebUploader() {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [dragging, setDragging] = useState(false);
  const files = useRef(new Map<string, File>());
  const running = useRef(false);
  const jobsRef = useRef<UploadJob[]>([]);

  const update = (id: string, patch: Partial<UploadJob>) => {
    jobsRef.current = jobsRef.current.map((j) => (j.id === id ? { ...j, ...patch } : j));
    setJobs(jobsRef.current);
  };

  const run = async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const job = jobsRef.current.find((j) => j.state === 'waiting');
        if (!job) break;
        update(job.id, { state: 'uploading' });
        try {
          await uploadFile(files.current.get(job.id)!, (p) => update(job.id, { progress: p }));
          update(job.id, { state: 'done', progress: 1 });
          void refreshRemote();
        } catch (e) {
          update(job.id, { state: 'failed', error: errorMessage(e) });
        } finally {
          files.current.delete(job.id);
        }
      }
    } finally {
      running.current = false;
    }
  };

  const add = (list: FileList | File[]) => {
    const added: UploadJob[] = [];
    for (const file of Array.from(list)) {
      if (!typeOf(file)) continue;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      files.current.set(id, file);
      added.push({ id, name: file.name, size: file.size, progress: 0, state: 'waiting' });
    }
    if (!added.length) return;
    jobsRef.current = [...jobsRef.current.filter((j) => j.state !== 'done'), ...added];
    setJobs(jobsRef.current);
    void run();
  };

  const pick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = ACCEPT;
    input.onchange = () => input.files && add(input.files);
    input.click();
  };

  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (e.dataTransfer?.files) add(e.dataTransfer.files);
    };
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (jobsRef.current.some((j) => j.state === 'uploading' || j.state === 'waiting')) e.preventDefault();
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const active = jobs.filter((j) => j.state !== 'done').length;
  const done = jobs.filter((j) => j.state === 'done').length;

  return (
    <>
      <Pressable onPress={pick} style={styles.button} accessibilityRole="button" accessibilityLabel="Upload photos and videos">
        <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
        <Text style={styles.buttonText}>Upload</Text>
      </Pressable>
      {dragging && (
        <View style={styles.drop} pointerEvents="none">
          <Ionicons name="cloud-upload-outline" size={48} color={colors.link} />
          <Text style={styles.dropText}>Drop photos and videos to upload at original quality</Text>
        </View>
      )}
      {jobs.length > 0 && (
        <View style={styles.panel} accessibilityLiveRegion="polite">
          <View style={styles.panelHead}>
            <Text style={styles.panelTitle}>{active ? `Uploading ${active} file${active === 1 ? '' : 's'}…` : `${done} uploaded`}</Text>
            {!active && (
              <Pressable onPress={() => setJobs((jobsRef.current = []))} hitSlop={8} accessibilityLabel="Close">
                <Ionicons name="close" size={18} color="#A1A1A6" />
              </Pressable>
            )}
          </View>
          {jobs.slice(-6).map((j) => (
            <View key={j.id} style={styles.row}>
              <Text style={styles.name} numberOfLines={1}>
                {j.name}
              </Text>
              <Text style={[styles.state, j.state === 'failed' && { color: colors.danger }]} numberOfLines={1}>
                {j.state === 'uploading' ? `${Math.round(j.progress * 100)}%` : j.state === 'failed' ? (j.error ?? 'Failed') : j.state === 'done' ? '✓' : '…'}
              </Text>
            </View>
          ))}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.action, paddingHorizontal: 14, minHeight: 36, borderRadius: 18, marginRight: 8 },
  buttonText: { color: '#fff', fontWeight: '600' },
  drop: {
    position: 'fixed' as 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderWidth: 3,
    borderColor: colors.link,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  dropText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  panel: {
    position: 'fixed' as 'absolute',
    right: 16,
    bottom: 16,
    width: 340,
    zIndex: 90,
    backgroundColor: '#1C1C1E',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1F2937',
    padding: 12,
  },
  panelHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  panelTitle: { color: '#fff', fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, gap: 8 },
  name: { color: '#E8E8ED', flex: 1, fontSize: 13 },
  state: { color: colors.link, fontSize: 13, maxWidth: 160 },
});
