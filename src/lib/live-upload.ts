// Upload while recording (Android). The camera writes the video to a file that
// only grows while recording; when recording stops, the MP4 writer goes back
// and rewrites the header at the start (and adds its index at the end). So:
//
//   - start an S3 multipart upload (size unknown) when recording starts,
//   - every few seconds upload each finished 8 MiB block of the growing file,
//     holding back the first 16 MiB (where the header lives),
//   - when recording stops: re-check the MD5 of every block already sent
//     against the final file (re-send any that changed), send the rest, and
//     complete with the final size.
//
// The cloud copy is byte-for-byte the phone's file; every part is MD5-checked
// by S3 on arrival. Anything that fails is finished by the regular uploader.
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { api } from './api';
import { fileSize } from './local-store';
import { writeChunkAt } from './storage/http';
import { md5Of, put } from './uploader';
import { RemoteMedia } from './types';

/** Blocks at the start of the file that are only sent after recording (header area). */
const HOLD_PARTS = 2;
/** Stay this far behind the writer: the newest bytes may still be in flight. */
const TAIL_MARGIN = 1024 * 1024;
const TICK_MS = 2000;

const recordingsDir = () => new Directory(Paths.cache, 'Camera');

function listRecordings(): Set<string> {
  try {
    const dir = recordingsDir();
    if (!dir.exists) return new Set();
    return new Set(
      dir
        .list()
        .filter((f): f is File => f instanceof File && f.name.endsWith('.mp4'))
        .map((f) => f.name),
    );
  } catch {
    return new Set();
  }
}

export type LiveUploadOptions = {
  /** Checked before each block: network policy, heat, etc. False = wait. */
  canSend: () => boolean;
  /** Bytes in the cloud (incl. the block being sent) vs the file's size so far. */
  onProgress?: (sent: number, total: number, recording: boolean) => void;
  /** The upload was dropped (recording failed or discarded). */
  onCancel?: () => void;
};

export class LiveUpload {
  readonly id: string;
  private partSize = 8 * 1024 * 1024;
  private started: Promise<boolean>;
  private before: Set<string>;
  private file: File | null = null;
  /** Part number → MD5 (base64) of what we sent. */
  private sent = new Map<number, string>();
  /** Part number → bytes of that part in the cloud. */
  private sentBytes = new Map<number, number>();
  /** Bytes of the part being sent right now. */
  private sending = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy: Promise<void> = Promise.resolve();
  private stopped = false;
  private failed = false;

  constructor(
    id: string,
    private options: LiveUploadOptions,
  ) {
    this.id = id;
    this.before = listRecordings();
    this.started = api
      .startUpload({ id, kind: 'video', contentType: 'video/mp4', size: 0, streaming: true, createdAt: Date.now() })
      .then((plan) => {
        if (plan.mode !== 'multipart') return false;
        this.partSize = plan.partSize;
        return true;
      })
      .catch(() => {
        this.failed = true;
        return false;
      });
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** Only Android records with an append-only writer we can follow. */
  static get supported() {
    return Platform.OS === 'android';
  }

  /** The camera's output file: the new .mp4 that appeared after recording started. */
  private findFile(): File | null {
    if (this.file) return this.file;
    for (const name of listRecordings()) {
      if (!this.before.has(name)) {
        this.file = new File(recordingsDir(), name);
        return this.file;
      }
    }
    return null;
  }

  private tick() {
    if (this.stopped || this.failed) return;
    this.busy = this.busy.then(() => this.sendReady()).catch(() => {
      // A failed block is retried on the next tick, or at finish.
    });
  }

  /** Sends every whole block past the held-back header area that's safely written. */
  private async sendReady() {
    if (!(await this.started)) return;
    const file = this.findFile();
    if (!file?.exists) return;
    const size = fileSize(file);
    this.report(size, true);
    if (!this.options.canSend()) return;
    for (let n = HOLD_PARTS + 1; n * this.partSize <= size - TAIL_MARGIN; n++) {
      if (this.stopped || !this.options.canSend()) return;
      if (this.sent.has(n)) continue;
      await this.sendPart(file, n, this.partSize, () => this.report(fileSize(file), !this.stopped));
    }
  }

  private report(total: number, recording: boolean) {
    let inCloud = this.sending;
    this.sentBytes.forEach((b) => (inCloud += b));
    this.options.onProgress?.(inCloud, total, recording);
  }

  private async sendPart(file: File, n: number, length: number, onBytes?: () => void) {
    const chunk = writeChunkAt(file, `live-${this.id}`, (n - 1) * this.partSize, length);
    try {
      const md5 = md5Of(chunk);
      const { urls } = await api.partUrls(this.id, [{ n, md5 }]);
      // A re-sent part (header rewritten) counts from zero again.
      this.sentBytes.delete(n);
      await put(chunk, urls[n], { 'Content-MD5': md5 }, (bytes) => {
        this.sending = bytes;
        onBytes?.();
      });
      this.sent.set(n, md5);
      this.sentBytes.set(n, length);
    } finally {
      this.sending = 0;
      if (chunk.exists) chunk.delete();
    }
  }

  /**
   * Recording stopped and the file was moved to `final` (same bytes). Re-sends
   * any block whose bytes changed, sends the rest and completes the upload.
   * Returns the media, or null to leave it to the regular uploader.
   */
  async finish(final: File, onProgress?: (fraction: number) => void): Promise<RemoteMedia | null> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.busy.catch(() => {});
    if (this.failed || !(await this.started)) return null;
    try {
      const size = fileSize(final);
      if (size <= 0) return null;
      const total = Math.ceil(size / this.partSize);
      const length = (n: number) => Math.min(this.partSize, size - (n - 1) * this.partSize);
      const progress = () => {
        this.report(size, false);
        onProgress?.(Math.min(1, [...this.sentBytes.values()].reduce((a, b) => a + b, this.sending) / size));
      };
      progress();
      for (let n = 1; n <= total; n++) {
        const previous = this.sent.get(n);
        if (previous && length(n) === this.partSize) {
          // Already sent: still the same bytes? (the header area may have been rewritten)
          const chunk = writeChunkAt(final, `check-${this.id}`, (n - 1) * this.partSize, length(n));
          const same = md5Of(chunk) === previous;
          if (chunk.exists) chunk.delete();
          if (same) continue;
        }
        await this.sendPart(final, n, length(n), progress);
        progress();
      }
      const { media } = await api.complete(this.id, size);
      return media;
    } catch {
      return null; // the regular uploader resumes with the same checks
    }
  }

  /** Recording failed or was discarded: drop the unfinished upload. */
  cancel() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.options.onCancel?.();
    void this.started.then((ok) => {
      if (ok) api.deleteMedia(this.id).catch(() => {});
    });
  }
}

