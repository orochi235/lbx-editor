import { describe, it, expect } from 'vitest';
import { migratePersistedScene } from './docMigrate';

const barcode = (over: Record<string, unknown> = {}) => ({
  id: 'n1',
  data: { kind: 'barcode', protocol: 'CODE128', data: 'SHELF-42', ...over },
});

describe('migratePersistedScene', () => {
  it('turns the opaque background on for a barcode saved before the field existed', () => {
    // The failure this prevents: the restored barcode draws no background, so
    // whatever is under it prints into its spaces and it stops scanning.
    const state = { nodes: [barcode()] };

    migratePersistedScene(state);

    expect(state.nodes[0]!.data).toMatchObject({ opaqueBackground: true });
  });

  it('leaves an explicit off alone', () => {
    // Only absence means "predates the field" — false is a real choice.
    const state = { nodes: [barcode({ opaqueBackground: false })] };

    migratePersistedScene(state);

    expect(state.nodes[0]!.data).toMatchObject({ opaqueBackground: false });
  });

  it('leaves an explicit on alone', () => {
    const state = { nodes: [barcode({ opaqueBackground: true })] };

    migratePersistedScene(state);

    expect(state.nodes[0]!.data).toMatchObject({ opaqueBackground: true });
  });

  it('ignores every other kind of node', () => {
    const state = {
      nodes: [
        { id: 'a', data: { kind: 'text', text: 'Shelf A' } },
        { id: 'b', data: { kind: 'image', src: '' } },
        { id: 'c', data: { kind: 'rect' } },
      ],
    };

    migratePersistedScene(state);

    for (const node of state.nodes) {
      expect(node.data).not.toHaveProperty('opaqueBackground');
    }
  });

  it('survives a state with no nodes at all', () => {
    expect(() => migratePersistedScene({})).not.toThrow();
    expect(() => migratePersistedScene({ nodes: [] })).not.toThrow();
  });
});
