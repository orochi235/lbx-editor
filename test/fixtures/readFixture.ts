/**
 * Real `.lbx` files, read as bytes for the import tests.
 *
 * These are files P-touch Editor wrote, kept verbatim. A test that rebuilds the
 * label from a `LabelConfig` in code checks our reading of our own writing and
 * proves nothing about the convention P-touch actually follows; only a file we
 * did not write can do that.
 *
 * Lives outside `src/` because it is test-only and reaches for `node:fs` — the
 * app itself never touches the filesystem, and the fixtures are binaries.
 */
import { readFile } from 'node:fs/promises';

/** The named fixture's bytes, resolved beside this file rather than against the
 *  working directory, so it reads the same however vitest was launched. */
export async function readFixture(name: string): Promise<ArrayBuffer> {
  const buf = await readFile(new URL(name, import.meta.url));
  // A Node Buffer is a view into a shared pool, so `buf.buffer` is whatever
  // else that pool holds. Slice to the view's own bytes or the zip is garbage.
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
