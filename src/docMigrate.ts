/**
 * Bringing an autosaved document forward when node data gains a field.
 *
 * The scene is persisted as raw JSON and restored through weasel's
 * `loadState`, which stores `data` verbatim — no factory, no defaulting. So a
 * required field added to `LabelNodeData` is enforced at every *construction*
 * site by the compiler and at none of the *restore* path: a document autosaved
 * before the field existed comes back with it `undefined`, and TypeScript
 * cannot see it because the JSON was never typed.
 *
 * That silence is why this exists rather than a `?? default` at each read.
 * Defaulting where the value is used spreads one decision across every
 * consumer and quietly makes the field optional again; doing it here keeps the
 * type honest and puts the compatibility decision in one place.
 */
import type { LabelNodeData } from './label';

/** The shape `scene.loadState` takes, as far as this needs to know it.
 *  `nodes` is readonly to match weasel's `SerializedScene` — the array isn't
 *  reordered here, only the `data` objects inside it are filled in. */
interface PersistedScene {
  nodes?: readonly { data?: unknown }[];
}

/**
 * Fill in fields added after a document may have been saved.
 *
 * Mutates and returns `state` — it has just come out of `JSON.parse` and has
 * no other owner.
 *
 * `opaqueBackground` (added 2026-07-28): absent means the document predates
 * the field, and the default is on. Matches the `.lbx` import rule for the
 * same reason — a barcode that comes back opaque still scans, where one that
 * comes back transparent prints artwork through its own spaces.
 */
export function migratePersistedScene<T extends PersistedScene>(state: T): T {
  for (const node of state.nodes ?? []) {
    const data = node.data as Partial<LabelNodeData> | undefined;
    if (data?.kind !== 'barcode') continue;
    if (data.opaqueBackground === undefined) data.opaqueBackground = true;
  }
  return state;
}
