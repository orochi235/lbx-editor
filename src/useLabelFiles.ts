import { useCallback, useRef } from 'react';
import { asNodeId, type Scene, type SelectionApi } from '@weasel-js/core';
import { toast } from '@weasel-js/ui/components/Toast';
import type { LabelLayer, LabelNodeData, LabelPose } from './label';
import { exportLbx } from './lbxExport';
import { importLbx } from './lbxImport';
import { snapNodePose } from './dotSnap';
import { PRINT_DPI } from './printDpi';
import { fileToBase64, guessMimeType, getImageDimensions } from './imageUtils';
import { genNodeId } from './nodeIds';
import type { LabelConfig } from './useLabelConfig';

interface LabelFilesArgs {
  scene: Scene<LabelNodeData, LabelLayer, LabelPose>;
  selection: SelectionApi;
  config: LabelConfig;
  paperWidth: number;
  paperHeight: number;
}

/** Files in and out: Open and Export .lbx, and drops onto the canvas — a
 *  .lbx replaces the document, an image is added to it. */
export function useLabelFiles({ scene, selection, config, paperWidth, paperHeight }: LabelFilesArgs) {
  const { tapeSize, autoLength, labelLength, cutMarks } = config;
  const { setTapeSize, setAutoLength, setManualLength, setCutMarks } = config;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addImageFromFile = useCallback(async (file: File) => {
    try {
      const mimeType = file.type || guessMimeType(file.name);
      const base64 = await fileToBase64(file);
      const dims = await getImageDimensions(base64, mimeType, paperWidth - 20, paperHeight - 10);

      const id = genNodeId();
      scene.add({
        kind: 'leaf',
        id,
        layer: 'objects' as LabelLayer,
        pose: { x: 10, y: 5, width: dims.width, height: dims.height },
        data: {
          kind: 'image',
          src: base64,
          originalName: file.name,
          mimeType,
        },
      });
      selection.set([id]);
    } catch {
      toast.error('Image not readable', {
        description: `Chrome may not decode "${file.name}". Try a PNG or JPEG.`,
      });
    }
  }, [scene, selection, paperWidth, paperHeight]);

  // Shared by the Open .lbx button and canvas drag-and-drop: replace the
  // whole document with the file's contents.
  const loadLbxFile = useCallback(async (file: File) => {
    try {
      const result = await importLbx(file);
      setTapeSize(result.tapeSize);
      setAutoLength(result.autoLength);
      // Under auto-length the imported length is already the fitted one, so
      // this only decides where a later auto-off lands.
      setManualLength(result.labelLength);
      setCutMarks(result.cutMarks);

      scene.batch(`Open ${file.name}`, () => {
        for (const [id] of scene.nodes) {
          scene.remove(id);
        }
        for (const node of result.nodes) {
          scene.add({
            kind: 'leaf',
            id: asNodeId(node.id),
            layer: 'objects' as LabelLayer,
            pose: snapNodePose(node.data, node.pose, PRINT_DPI),
            data: node.data,
          });
        }
      });
    } catch {
      toast.error('Not a readable .lbx', {
        description: `"${file.name}" couldn't be parsed as a P-touch label file.`,
      });
    }
  }, [scene, setTapeSize, setAutoLength, setManualLength, setCutMarks]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    // .lbx has no reliable MIME type (it's a zip) — go by extension.
    if (file.name.toLowerCase().endsWith('.lbx')) {
      void loadLbxFile(file);
    } else if (file.type.startsWith('image/')) {
      addImageFromFile(file);
    }
  }, [loadLbxFile, addImageFromFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleExport = useCallback(async () => {
    // `roots` is stacking order, back to front; `nodes` is insertion order,
    // which a restack leaves untouched.
    const nodes = scene.roots.flatMap((id) => {
      const node = scene.get(id);
      return node ? [{ id: node.id, data: node.data, pose: node.pose }] : [];
    });
    const buf = await exportLbx(nodes, tapeSize, autoLength, labelLength, cutMarks);
    const blob = new Blob([buf as BlobPart], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'label.lbx';
    a.click();
    URL.revokeObjectURL(url);
  }, [scene, tapeSize, autoLength, labelLength, cutMarks]);

  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await loadLbxFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [loadLbxFile]);

  const openFilePicker = useCallback(() => fileInputRef.current?.click(), []);

  return { fileInputRef, handleImport, openFilePicker, handleExport, handleDrop, handleDragOver };
}
