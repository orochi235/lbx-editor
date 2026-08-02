/**
 * ISO/IEC 16022 default bit placement.
 *
 * Each codeword's 8 bits go into an L-shaped "utah" pattern that walks the
 * matrix diagonally, wrapping at the edges by four corner-case rules that
 * depend only on the matrix dimensions. The algorithm is the standard's, and
 * the corner cases are the part worth reading twice — they exist because the
 * diagonal walk does not tile a rectangle evenly.
 *
 * Transcribed from BWIPP's own placement routine (`/module`, `datamatrix.dmn`
 * and `datamatrix.dmc1`..`dmc4` in `node_modules/bwip-js/barcode.ps`), which is
 * the independent reference this repo already keeps for the size table: the
 * eight utah offsets, the four corner shapes, the MSB-first bit order, the
 * wrap arithmetic and the sweep steps all came from there rather than from
 * memory. What that transcription does *not* prove is that the assembled
 * symbol scans; the module-for-module diff against bwip-js does.
 *
 * Coordinates are (row, col) into the data area, with the finder pattern and
 * any region separators added by the caller.
 */

export function placeCodewords(
  codewords: readonly number[],
  rows: number,
  cols: number,
): boolean[][] {
  const grid: (boolean | null)[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => null),
  );

  /** Write one bit, wrapping a position that fell off the top or the left edge
   *  back around. The column shift on a row wrap (and vice versa) is what
   *  keeps the wrapped bits clear of the ones already placed. */
  const bit = (r: number, c: number, value: boolean) => {
    let row = r;
    let col = c;
    if (row < 0) {
      row += rows;
      col += 4 - ((rows + 4) % 8);
    }
    if (col < 0) {
      col += cols;
      row += 4 - ((cols + 4) % 8);
    }
    // A column wrap can push the row back off the bottom. Never happens for the
    // square family — nor for any ECC200 rectangle — but it is BWIPP's third
    // clause, and dropping it would be a silent divergence from the reference.
    if (row >= rows) row -= rows;
    grid[row]![col] = value;
  };

  /** Bit n of the codeword, numbered 1..8 from the most significant. */
  const bitsOf = (cw: number) => (n: number) => (cw & (1 << (8 - n))) !== 0;

  const utah = (r: number, c: number, cw: number) => {
    const b = bitsOf(cw);
    bit(r - 2, c - 2, b(1));
    bit(r - 2, c - 1, b(2));
    bit(r - 1, c - 2, b(3));
    bit(r - 1, c - 1, b(4));
    bit(r - 1, c, b(5));
    bit(r, c - 2, b(6));
    bit(r, c - 1, b(7));
    bit(r, c, b(8));
  };

  const corner1 = (cw: number) => {
    const b = bitsOf(cw);
    bit(rows - 1, 0, b(1));
    bit(rows - 1, 1, b(2));
    bit(rows - 1, 2, b(3));
    bit(0, cols - 2, b(4));
    bit(0, cols - 1, b(5));
    bit(1, cols - 1, b(6));
    bit(2, cols - 1, b(7));
    bit(3, cols - 1, b(8));
  };

  const corner2 = (cw: number) => {
    const b = bitsOf(cw);
    bit(rows - 3, 0, b(1));
    bit(rows - 2, 0, b(2));
    bit(rows - 1, 0, b(3));
    bit(0, cols - 4, b(4));
    bit(0, cols - 3, b(5));
    bit(0, cols - 2, b(6));
    bit(0, cols - 1, b(7));
    bit(1, cols - 1, b(8));
  };

  const corner3 = (cw: number) => {
    const b = bitsOf(cw);
    bit(rows - 3, 0, b(1));
    bit(rows - 2, 0, b(2));
    bit(rows - 1, 0, b(3));
    bit(0, cols - 2, b(4));
    bit(0, cols - 1, b(5));
    bit(1, cols - 1, b(6));
    bit(2, cols - 1, b(7));
    bit(3, cols - 1, b(8));
  };

  const corner4 = (cw: number) => {
    const b = bitsOf(cw);
    bit(rows - 1, 0, b(1));
    bit(rows - 1, cols - 1, b(2));
    bit(0, cols - 3, b(3));
    bit(0, cols - 2, b(4));
    bit(0, cols - 1, b(5));
    bit(1, cols - 3, b(6));
    bit(1, cols - 2, b(7));
    bit(1, cols - 1, b(8));
  };

  const free = (r: number, c: number) =>
    r >= 0 && r < rows && c >= 0 && c < cols && grid[r]![c] === null;

  let index = 0;
  let row = 4;
  let col = 0;
  do {
    // BWIPP tests these four independently rather than as a chain, and the two
    // forms agree: no two can hold at once. corner1/2/3 sit at col 0 and
    // corner4 at col 2; corner1 sits at row `rows` and corner2/3 at `rows - 2`;
    // and corner2 and corner3 are disjoint rather than nested, because
    // `cols % 8 === 4` *implies* `cols % 4 === 0`, which is exactly what
    // corner2 excludes. Over the square family corner1 fires for a data area
    // whose side is 4 mod 8 and corner2 for 6 mod 8; corner3 and corner4 never
    // fire, and only earn their keep on the rectangular symbols this module
    // does not yet emit.
    if (row === rows && col === 0) corner1(codewords[index++] ?? 0);
    else if (row === rows - 2 && col === 0 && cols % 4 !== 0) corner2(codewords[index++] ?? 0);
    else if (row === rows - 2 && col === 0 && cols % 8 === 4) corner3(codewords[index++] ?? 0);
    else if (row === rows + 4 && col === 2 && cols % 8 === 0) corner4(codewords[index++] ?? 0);

    // Sweep up and to the right.
    do {
      if (free(row, col)) utah(row, col, codewords[index++] ?? 0);
      row -= 2;
      col += 2;
    } while (row >= 0 && col < cols);
    row += 1;
    col += 3;

    // Sweep down and to the left.
    do {
      if (free(row, col)) utah(row, col, codewords[index++] ?? 0);
      row += 2;
      col -= 2;
    } while (row < rows && col >= 0);
    row += 3;
    col += 1;
  } while (row < rows || col < cols);

  // The bottom-right 2x2 is unused in symbols whose area is not a multiple of
  // 8 — the square sides that are 2 or 6 mod 8 — and the standard fills it with
  // a fixed checkerboard rather than data.
  if (grid[rows - 1]![cols - 1] === null) {
    grid[rows - 2]![cols - 2] = true;
    grid[rows - 2]![cols - 1] = false;
    grid[rows - 1]![cols - 2] = false;
    grid[rows - 1]![cols - 1] = true;
  }

  return grid.map((r) => r.map((cell) => cell ?? false));
}
