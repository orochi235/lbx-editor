# lbx-editor

Web-based visual editor for Brother P-touch label files (`.lbx`). Built with
Vite and React on top of [weasel](https://www.npmjs.com/package/@weasel-js/core)
for the scene graph and canvas, `bil-lbx` for `.lbx` parsing and serialization,
and `obwat` for printing over WebUSB / Web Serial.

```sh
npm install
npm run dev    # http://localhost:5180
npm test
npm run build
```

See `CLAUDE.md` for architecture notes.

## Third-party code

Most dependencies are ordinary npm packages. One piece of third-party source is
embedded directly in this repository:

- **`src/barcode/pdf417Table.ts`** — the PDF417 codeword pattern table (929
  codewords x 3 clusters), taken from
  [zxing](https://github.com/zxing/zxing)'s
  `core/src/main/java/com/google/zxing/pdf417/encoder/PDF417.java`
  (`CODEWORD_TABLE`), which is itself Annex A of ISO/IEC 15438:2001(E). The
  data was reformatted from the Java literal into TypeScript arrays; the values
  and their order are unchanged. zxing is licensed under the Apache License
  2.0 — the full licence text, the original copyright line, and the pertinent
  part of zxing's `NOTICE` are in
  [`licenses/zxing-APACHE-2.0.txt`](licenses/zxing-APACHE-2.0.txt).

  The table is sourced from zxing rather than from bwip-js on purpose: bwip-js
  is this repo's test oracle for barcode encoding, and a table copied from the
  oracle and then verified against it would be checking the data against
  itself.
