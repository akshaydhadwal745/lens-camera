export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

/** Upload speed, e.g. "0.6 MB/s". */
export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(Math.round(bytesPerSecond))}/s`;
}

/** Time left for `remaining` bytes at `rate`, e.g. "~23 min left" (empty if unknown). */
export function formatEta(remaining: number, rate: number): string {
  if (rate <= 0 || remaining <= 0) return '';
  const s = remaining / rate;
  if (s < 60) return 'under a minute left';
  if (s < 3600) return `~${Math.round(s / 60)} min left`;
  return `~${(s / 3600).toFixed(s < 36000 ? 1 : 0)} h left`;
}

/** Paise as rupees with Indian digit grouping, e.g. ₹12,34,567.89. */
export function rupees(paise = 0): string {
  const sign = paise < 0 ? '−' : '';
  const [whole, frac] = (Math.abs(paise) / 100).toFixed(2).split('.');
  // Indian grouping: 12,34,567.89
  const head = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${sign}₹${head ? `${head},` : ''}${whole.slice(-3)}.${frac}`;
}
