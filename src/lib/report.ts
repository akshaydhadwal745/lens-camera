// Report objectionable content or a person (Google Play user-generated content policy:
// apps where people send each other content need in-app reporting next to blocking).
// Reports travel the feedback pipeline (infra/lambda/api/feedback.ts: stored, emailed to the
// team, Admin → Feedback, rate limited) as kind "report" with what was reported.
import { api } from './api';
import { chooseAction, errorMessage, notify } from './ui';

const REASONS = [
  { value: 'sexual', label: 'Nudity or sexual content' },
  { value: 'violence', label: 'Violence or threats' },
  { value: 'harassment', label: 'Harassment or hate' },
  { value: 'spam', label: 'Spam or scam' },
  { value: 'other', label: 'Something else' },
] as const;
type Reason = (typeof REASONS)[number]['value'];

export type ReportTarget = {
  /** What is reported: a photo/video someone shared, or a share request (the sender). */
  what: 'shared-item' | 'share-request';
  /** The person who sent it. */
  ownerId?: string;
  ownerName?: string;
  mediaId?: string;
  shareId?: string;
};

/**
 * Asks why, sends the report, then offers to block the sender. Resolves to the action the
 * person chose after reporting ('block' | null), so the caller can also remove the item.
 */
export async function reportContent(target: ReportTarget): Promise<'block' | null> {
  const who = target.ownerName ?? 'this person';
  const reason = await chooseAction<Reason>(
    target.what === 'shared-item' ? 'Report this?' : `Report ${who}?`,
    'Lens reviews reports and removes content and accounts that break the rules. They aren’t told who reported them.',
    REASONS.map((r) => ({ value: r.value, label: r.label })),
  );
  if (!reason) return null;
  const label = REASONS.find((r) => r.value === reason)!.label;
  const lines = [
    `[report] ${label}`,
    `what: ${target.what}`,
    target.ownerId ? `owner: ${target.ownerName ?? '?'} (${target.ownerId})` : '',
    target.mediaId ? `media: ${target.mediaId}` : '',
    target.shareId ? `share: ${target.shareId}` : '',
  ].filter(Boolean);
  try {
    // kind "report": the API files unknown kinds as "other" until its report kind is deployed.
    await api.sendFeedback({ kind: 'report', source: 'report', message: lines.join('\n'), includeDevice: false });
  } catch (error) {
    notify('Couldn’t send the report', errorMessage(error));
    return null;
  }
  if (!target.ownerId) {
    notify('Thanks for reporting', 'We’ll review it.');
    return null;
  }
  const next = await chooseAction<'block'>('Thanks for reporting', `We’ll review it. You can also block ${who}: they can’t send you anything again.`, [
    { value: 'block', label: `Block ${who}`, destructive: true },
  ]);
  if (next !== 'block') return null;
  try {
    await api.setBlocked(target.ownerId, true);
    notify(`${who} blocked`, 'Unblock any time in Settings → Blocked people.');
    return 'block';
  } catch (error) {
    notify('Couldn’t block', errorMessage(error));
    return null;
  }
}
