/**
 * Convert the editor's scene graph into a bil-lbx LabelConfig and build
 * the .lbx file.
 */
import {
  buildLbx,
  backgroundFor,
  AUTO_LENGTH_MAX_PT,
  TAPE,
  type LabelConfig,
  type LabelObject as LbxObject,
} from 'bil-lbx';
import { ensureBmp32Bytes } from './imageUtils';
import { encodeBarcode, barcodeRequest, barcodeModulePt } from './barcode';
import { boxFromSymbolPose } from './barcode/poseBox';
import { DEFAULT_LABEL_LENGTH, lineEndpoints, type LabelNodeData, type LabelPose, type TapeSize } from './label';

interface SceneNode {
  id: string;
  data: LabelNodeData;
  pose: LabelPose;
}

const TAPE_FORMAT_MAP: Record<TapeSize, { width: number; format: number }> = {
  '6mm': TAPE['6mm'],
  '9mm': TAPE['9mm'],
  '12mm': TAPE['12mm'],
  '18mm': TAPE['18mm'],
  '24mm': TAPE['24mm'],
  '36mm': TAPE['36mm'],
};

/**
 * The data column count behind a PDF417's module width, or undefined if that
 * width isn't one a PDF417 can have. Inverts
 * `moduleWidth = 17 * (columns + 4) + 1` — 17 modules per column plus a start
 * pattern, two row indicators and an 18-module stop.
 */
function pdf417ColumnsFor(cols: number): number | undefined {
  const columns = (cols - 1) / 17 - 4;
  return Number.isInteger(columns) && columns >= 1 ? columns : undefined;
}

export function sceneToLbxConfig(
  nodes: SceneNode[],
  tapeSize: TapeSize,
  autoLength: boolean,
  labelLength?: number,
  cutMarks: number[] = [],
): LabelConfig {
  const tape = TAPE_FORMAT_MAP[tapeSize];
  const objects: LbxObject[] = [];

  for (const node of nodes) {
    const { data, pose } = node;
    switch (data.kind) {
      case 'text':
        objects.push({
          type: 'text',
          position: { x: pose.x, y: pose.y, width: pose.width, height: pose.height },
          font: {
            name: data.fontFamily,
            size: data.fontSize,
            weight: data.fontWeight,
            italic: data.italic,
          },
          data: data.text,
          horizontalAlignment: data.horizontalAlignment,
          verticalAlignment: data.verticalAlignment,
          textStyle: { color: data.color },
        });
        break;
      case 'rect':
        objects.push({
          type: 'rect',
          position: { x: pose.x, y: pose.y, width: pose.width, height: pose.height },
          shape: data.rounded ? 'ROUNDRECTANGLE' : 'RECTANGLE',
          roundnessX: data.roundness,
          roundnessY: data.roundness,
          pen: { style: 'INSIDEFRAME', widthX: data.strokeWidth, widthY: data.strokeWidth, color: data.strokeStyle },
        });
        break;
      case 'line':
        objects.push({
          type: 'line',
          position: { x: pose.x, y: pose.y, width: pose.width, height: pose.height },
          points: lineEndpoints(pose, data.descending).map((p) => ({ x: p.x, y: p.y })),
          pen: { style: 'SOLID', widthX: data.strokeWidth, widthY: data.strokeWidth, color: data.strokeStyle },
        });
        break;
      case 'barcode': {
        // The pose is authoritative for us; P-touch redraws a barcode from a
        // module width recorded under a *different attribute per symbology* —
        // barWidth for 1D, qrcodeStyle cellSize, datamatrixStyle cellSize,
        // pdf417Style width. Restate the pose in whichever one applies so the
        // two agree on the drawn size. Sending it to the wrong one is worse
        // than sending nothing: bil-lbx writes a style element only for the
        // matching protocol, so a cellSize on a PDF417 is dropped on the floor
        // and the symbol reopens at whatever size the reader invents.
        // Falls back to the imported values when the payload doesn't encode —
        // nothing better to say.
        const encoded = encodeBarcode(barcodeRequest(data));
        const modulePt = encoded.ok ? barcodeModulePt(encoded, pose) : undefined;
        const symbol2d = encoded.ok && encoded.kind === '2d' ? encoded : undefined;
        const cellPt = symbol2d !== undefined ? modulePt : undefined;
        const barWidth =
          encoded.ok && encoded.kind === '1d' && modulePt !== undefined ? modulePt : data.barWidth;

        // P-touch's 2D object box is the symbol plus a flat 2 modules per side;
        // import strips them, so export has to put them back or a file
        // round-trips 4 modules smaller than it arrived. 1D boxes are the bars
        // alone under the `margin="false"` we write, so they go out as-is.
        const position =
          cellPt !== undefined
            ? boxFromSymbolPose(pose, cellPt)
            : { x: pose.x, y: pose.y, width: pose.width, height: pose.height };

        const qrCode =
          data.protocol === 'QRCODE' && cellPt !== undefined
            ? { ...data.qrCode, cellSize: cellPt }
            : data.protocol === 'QRCODE'
              ? data.qrCode
              : undefined;

        // `model: 'square'` states what we drew rather than what was asked for:
        // `encodeDataMatrix` builds square symbols only, and .lbx has no field
        // for a rectangular one to have come from.
        const dataMatrix =
          data.protocol === 'DATAMATRIX' && cellPt !== undefined
            ? { ...data.dataMatrix, model: 'square' as const, cellSize: cellPt }
            : data.protocol === 'DATAMATRIX'
              ? data.dataMatrix
              : undefined;

        // Write the layout we drew rather than "auto": P-touch's own choice
        // isn't ours — 7 rows against bwip-js's 21 for the same payload — and
        // an "auto" invites it to redraw the symbol a different size. The
        // column count is the inverse of `moduleWidth = 17 * (columns + 4) + 1`;
        // it can only come out fractional if that identity ever stops holding,
        // and then there is no honest count to state, so the shape is left
        // however it came in.
        const pdf417Columns =
          symbol2d !== undefined ? pdf417ColumnsFor(symbol2d.cols) : undefined;
        const pdf417 =
          data.protocol === 'PDF417' &&
          symbol2d !== undefined &&
          cellPt !== undefined &&
          pdf417Columns !== undefined
            ? {
                ...data.pdf417,
                model: 'standard',
                width: cellPt,
                aspect: symbol2d.rowHeightModules,
                row: String(symbol2d.rows),
                column: String(pdf417Columns),
                // The level we landed on isn't reported back — `Symbol2D` is a
                // module grid — so anything but the file's own answer would be
                // a guess. Safe to leave: the drawn size is fixed by the row,
                // column, width and aspect beside it, and the level moves only
                // the boundary between padding and error correction inside a
                // matrix those four already decided.
                eccLevel: data.pdf417?.eccLevel ?? 'auto',
              }
            : data.protocol === 'PDF417'
              ? data.pdf417
              : undefined;

        objects.push({
          type: 'barcode',
          position,
          protocol: data.protocol,
          data: data.data,
          barWidth,
          barRatio: data.barRatio,
          humanReadable: data.humanReadable,
          humanReadableAlignment: data.humanReadableAlignment,
          checkDigit: data.checkDigit,
          zeroFill: data.zeroFill,
          // P-touch may or may not honor a brush on a barcode — unverified;
          // `pte-probes/05-barcode-brush.lbx` is the file that asks. Written
          // faithfully either way so the file states what we drew.
          // It does survive our own reimport, even though bil-lbx collapses a
          // NULL brush to undefined: `fileMeansItsBrush` reads undefined as
          // "off" in a file we stamped, so only a P-touch file loses the
          // distinction — and there it never carried one.
          brush: data.opaqueBackground
            ? { style: 'SOLID' as const, color: '#FFFFFF' }
            : { style: 'NULL' as const },
          ...(qrCode ? { qrCode } : {}),
          ...(dataMatrix ? { dataMatrix } : {}),
          ...(pdf417 ? { pdf417 } : {}),
        });
        break;
      }
      case 'image': {
        // Decode base64 to Uint8Array
        const binary = atob(data.src);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        objects.push({
          type: 'image',
          position: { x: pose.x, y: pose.y, width: pose.width, height: pose.height },
          imageData: bytes,
          originalName: data.originalName,
        });
        break;
      }
    }
  }

  // An auto-length label's paper height is P-touch's placeholder, so the length
  // has nowhere to live but the background band — write it there explicitly or
  // the file reimports at the placeholder's 1000mm.
  const paper = {
    width: tape.width,
    format: tape.format,
    autoLength,
    height: autoLength ? AUTO_LENGTH_MAX_PT : labelLength,
  };

  return {
    paper,
    background: backgroundFor(paper, labelLength ?? DEFAULT_LABEL_LENGTH),
    objects,
    ...(cutMarks.length > 0 ? { cut: { freeCut: [...cutMarks].sort((a, b) => a - b) } } : {}),
  };
}

export async function exportLbx(
  nodes: SceneNode[],
  tapeSize: TapeSize,
  autoLength: boolean,
  labelLength?: number,
  cutMarks: number[] = [],
): Promise<Uint8Array> {
  const config = sceneToLbxConfig(nodes, tapeSize, autoLength, labelLength, cutMarks);
  // .lbx embeds only BMP: transcode user-inserted PNG/JPEG bytes here, at
  // the file boundary, so the in-editor node keeps its original (smaller,
  // lossless-round-tripping) source bytes.
  for (const obj of config.objects) {
    if (obj.type === 'image') obj.imageData = await ensureBmp32Bytes(obj.imageData, obj.position);
  }
  return await buildLbx(config);
}
