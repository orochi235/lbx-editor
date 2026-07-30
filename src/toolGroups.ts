/**
 * Palette grouping for the tool bar.
 *
 * `ToolPalette` clusters buttons by each tool's `presentation.group` and draws
 * a separator between clusters; its `groupOrder` prop permutes the clusters but
 * cannot move a tool from one to another. The kit's own taxonomy doesn't match
 * this app's: `hand` is 'view', away from `select`; `text` is 'type', away from
 * the shapes; `image` is 'shape', in with rect and line. So the app restates
 * the grouping on the tools it rebuilds from the kit's public factories.
 *
 * `group` is documented as a free-form string, which is what makes this the
 * consumer's call rather than a kit change.
 *
 * This module holds no React and imports nothing from weasel at runtime, so a
 * test can load it — importing App.tsx pulls in obwat, whose dist uses
 * extensionless imports vitest won't resolve.
 */

/**
 * The three clusters, in the order the palette renders them.
 *
 * - `select` — pick things and move the view. Keeps the kit's own name for it,
 *   because the `select` tool itself isn't rebuilt and so keeps that group.
 * - `shape` — draw a primitive: line, rect, text.
 * - `insert` — place prepared content: an image file, an encoded barcode.
 */
export const PALETTE_GROUP_ORDER = ['select', 'shape', 'insert'] as const;

export type PaletteGroup = (typeof PALETTE_GROUP_ORDER)[number];

/**
 * Which cluster each palette tool belongs in, keyed by tool id.
 *
 * Tools whose kit-native group is already correct (`select`, `rect`, `line`)
 * are listed anyway: this is the whole intended layout in one place, and the
 * test reads it to check nothing lands outside `PALETTE_GROUP_ORDER`.
 */
export const TOOL_GROUPS: Readonly<Record<string, PaletteGroup>> = {
  select: 'select',
  hand: 'select',
  line: 'shape',
  rect: 'shape',
  text: 'shape',
  image: 'insert',
  barcode: 'insert',
};

/** The palette's left-to-right order within each cluster is registration
 *  order, so this is the order tools must be registered in. */
export const PALETTE_TOOL_ORDER = [
  'select',
  'hand',
  'line',
  'rect',
  'text',
  'image',
  'barcode',
] as const;

/** A tool as the palette reads it. Structural, so no weasel import is needed. */
interface Grouped {
  presentation?: { group?: string };
}

/**
 * The same tool, in a different palette cluster.
 *
 * Spreads rather than mutates: the kit's factories memoize the tool they
 * return, and writing through that reference would change what every other
 * holder sees.
 */
export function inGroup<T extends Grouped>(tool: T, group: PaletteGroup): T {
  return { ...tool, presentation: { ...tool.presentation, group } };
}
