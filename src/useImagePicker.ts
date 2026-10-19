import { useCallback, useEffect, useRef } from 'react';
import type { ToolsApi } from '@weasel-js/core';
import { toast } from '@weasel-js/ui/components/Toast';
import { fileToBase64, guessMimeType, getImageDimensions } from './imageUtils';
import type { PendingImage } from './imageInsert';

/**
 * The image tool's file picker: a hidden input opened on entry into the tool,
 * whose pick is staged in `pendingImageRef` until a canvas drag places it.
 */
export function useImagePicker(tools: ToolsApi | null, paperWidth: number, paperHeight: number) {
  const pendingImageRef = useRef<PendingImage | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const toolsRef = useRef(tools);
  toolsRef.current = tools;

  const handleImagePick = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (imageInputRef.current) imageInputRef.current.value = '';
    if (!file) return;
    try {
      const mimeType = file.type || guessMimeType(file.name);
      const src = await fileToBase64(file);
      const dims = await getImageDimensions(src, mimeType, paperWidth - 20, paperHeight - 10);
      pendingImageRef.current = {
        src,
        originalName: file.name,
        mimeType,
        defaultWidth: dims.width,
        defaultHeight: dims.height,
      };
    } catch {
      // Undecodable pick: without this, the crosshair stays armed and every
      // drag silently inserts nothing (the factory rejects on null pending).
      pendingImageRef.current = null;
      if (toolsRef.current?.active === 'image') toolsRef.current.setActive('select');
      toast.error('Image not readable', {
        description: `Chrome may not decode "${file.name}". Try a PNG or JPEG.`,
      });
    }
  }, [paperWidth, paperHeight]);

  // The palette's IMG button just does tools.setActive('image') (registry-
  // driven palette, no picker hook on the tool). Observe the activation
  // transition and open the hidden file input; a fresh pick happens on every
  // entry into the tool. Re-picking without switching tools first is not
  // supported (setActive on the active id is a no-op).
  const prevActiveToolRef = useRef<string | null>(null);
  useEffect(() => {
    const active = tools?.active ?? null;
    if (active === 'image' && prevActiveToolRef.current !== 'image') {
      imageInputRef.current?.click();
    }
    prevActiveToolRef.current = active;
  }, [tools]);

  // Dismissing the picker means "never mind": revert to select so an
  // imageless crosshair tool isn't left active. Native `cancel` event
  // (Chrome 113+); this app is Chrome-only (WebUSB).
  useEffect(() => {
    const input = imageInputRef.current;
    if (!input) return;
    const onCancel = () => {
      const t = toolsRef.current;
      if (t?.active === 'image') t.setActive('select');
    };
    input.addEventListener('cancel', onCancel);
    return () => input.removeEventListener('cancel', onCancel);
  }, []);

  return { pendingImageRef, imageInputRef, handleImagePick };
}
