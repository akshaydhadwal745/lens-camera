// The "Delete" button flow shared by the gallery and the viewer: confirm, move
// to Trash, and for shared items ask "for everyone" or "only for me".
import { deleteItems, getState, selectUnsafeToDelete } from './store';
import { chooseAction, confirmDestructive, notify } from './ui';

/** Returns true if anything was deleted. */
export async function confirmAndDelete(ids: string[]): Promise<boolean> {
  if (!ids.length) return false;
  const one = ids.length === 1;
  const unsafe = selectUnsafeToDelete(getState(), ids);
  const message = [
    `${one ? 'It' : 'They'} will be removed from this device and kept in Trash for 30 days, then in the Archive for a year.`,
    unsafe
      ? one
        ? 'It hasn’t finished uploading, so it will be deleted permanently.'
        : `${unsafe} of them ${unsafe === 1 ? 'hasn’t' : 'haven’t'} finished uploading, so ${unsafe === 1 ? 'that one' : 'those'} will be deleted permanently.`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  if (!(await confirmDestructive(one ? 'Delete this item?' : `Delete ${ids.length} items?`, message))) return false;

  let { failed, needsScope } = await deleteItems(ids);
  let deleted = ids.length - failed.length - needsScope.length;

  if (needsScope.length) {
    const scope = await chooseAction(
      needsScope.length === 1 ? 'This item is shared' : `${needsScope.length} items are shared`,
      'Delete for everyone you shared with, or only remove it from your library? (They keep their copy.)',
      [
        { value: 'everyone', label: 'Delete for everyone', destructive: true },
        { value: 'me', label: 'Only for me' },
      ],
    );
    if (scope) {
      const second = await deleteItems(needsScope, scope);
      failed = [...failed, ...second.failed];
      deleted += needsScope.length - second.failed.length;
    }
  }

  if (failed.length) notify('Some items could not be deleted', 'Check your connection and try again.');
  return deleted > 0;
}
