import { describe, it, expect } from 'vitest';
import {
  PALETTE_GROUP_ORDER,
  PALETTE_TOOL_ORDER,
  TOOL_GROUPS,
  inGroup,
} from './toolGroups';

describe('palette grouping', () => {
  it('puts every tool in a group the palette actually renders', () => {
    // A typo'd group string doesn't throw — it silently opens a fourth
    // cluster, which `groupOrder` then appends after the three intended ones.
    for (const [id, group] of Object.entries(TOOL_GROUPS)) {
      expect(PALETTE_GROUP_ORDER, `tool "${id}"`).toContain(group);
    }
  });

  it('groups the tools the way the toolbar is meant to read', () => {
    const byGroup = (g: string) =>
      PALETTE_TOOL_ORDER.filter((id) => TOOL_GROUPS[id] === g);
    expect(byGroup('select')).toEqual(['select', 'hand']);
    expect(byGroup('shape')).toEqual(['line', 'rect', 'text']);
    expect(byGroup('insert')).toEqual(['image', 'barcode']);
  });

  it('registers tools so each cluster is contiguous in registration order', () => {
    // Within a cluster the palette renders in registration order, so
    // PALETTE_TOOL_ORDER has to visit the groups in PALETTE_GROUP_ORDER
    // without revisiting one.
    const seen = PALETTE_TOOL_ORDER.map((id) => TOOL_GROUPS[id]);
    const runs = seen.filter((g, i) => g !== seen[i - 1]);
    expect(runs).toEqual([...PALETTE_GROUP_ORDER]);
  });

  it('accounts for every tool the palette shows', () => {
    expect([...PALETTE_TOOL_ORDER].sort()).toEqual(Object.keys(TOOL_GROUPS).sort());
  });

  it('regroups a tool without touching the kit\'s own object', () => {
    const kitTool = { id: 'hand', presentation: { label: 'Hand', group: 'view' } };
    const moved = inGroup(kitTool, 'select');

    expect(moved.presentation.group).toBe('select');
    expect(moved.presentation.label).toBe('Hand');
    // The factory memoizes what it returns; mutating it would change what
    // every other holder of that reference sees.
    expect(kitTool.presentation.group).toBe('view');
  });

  it('gives a tool with no presentation at all a group', () => {
    // `presentation` is optional on the kit's Tool, so absent is a real case.
    const bare: { id: string; presentation?: { group?: string } } = { id: 'x' };
    expect(inGroup(bare, 'shape').presentation).toEqual({ group: 'shape' });
  });
});
