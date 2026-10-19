import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Scene } from '@weasel-js/core';
import {
  DEFAULT_TAPE,
  DEFAULT_LABEL_LENGTH,
  type LabelLayer,
  type LabelNodeData,
  type LabelPose,
  type TapeSize,
} from './label';
import { fitLengthToContent } from './autoLength';
import { equalCutMarks } from './cutMarks';

/** The document's tape, length and cut marks — everything about the label
 *  that isn't an object on it. */
export function useLabelConfig(
  scene: Scene<LabelNodeData, LabelLayer, LabelPose>,
  sceneVersion: number,
) {
  const [tapeSize, setTapeSize] = useState<TapeSize>(DEFAULT_TAPE);
  const [autoLength, setAutoLength] = useState(false);
  // The length the user typed. Under auto-length it's dormant — kept so that
  // switching auto off doesn't teleport the label back to a stale value.
  const [manualLength, setManualLength] = useState(DEFAULT_LABEL_LENGTH);
  // Cut positions (pt along the label): the printer cuts here, splitting the
  // document into a strip of labels. Round-trips .lbx via style:cutLine.
  const [cutMarks, setCutMarks] = useState<number[]>([]);

  // Auto-length: the label ends a margin past the rightmost object, refitting
  // on every committed scene change. Everything downstream reads labelLength
  // and so follows the fit for free.
  const fittedLength = useMemo(
    () => fitLengthToContent([...scene.nodes.values()].map((n) => n.pose)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sceneVersion is the change signal; scene is mutable.
    [scene, sceneVersion],
  );
  const labelLength = autoLength ? fittedLength : manualLength;

  // Turning auto off pins the length where the fit left it, rather than
  // snapping back to whatever was last typed.
  const handleAutoLengthChange = useCallback((auto: boolean) => {
    if (!auto) setManualLength(fittedLength);
    setAutoLength(auto);
  }, [fittedLength]);

  // The Labels control: N equal segments ↔ N-1 evenly spaced cut marks.
  // Setting it replaces any custom (imported) marks with the equal split.
  const handleLabelsCountChange = useCallback((n: number) => {
    const labels = Math.max(1, Math.min(50, Math.round(n)));
    setCutMarks(equalCutMarks(labelLength, labels));
  }, [labelLength]);

  // Marks past the end of a shortened label are meaningless — drop them.
  useEffect(() => {
    setCutMarks((marks) =>
      marks.every((x) => x > 0 && x < labelLength)
        ? marks
        : marks.filter((x) => x > 0 && x < labelLength),
    );
  }, [labelLength]);

  return {
    tapeSize, setTapeSize,
    autoLength, setAutoLength, handleAutoLengthChange,
    manualLength, setManualLength,
    cutMarks, setCutMarks, handleLabelsCountChange,
    labelLength,
  };
}

export type LabelConfig = ReturnType<typeof useLabelConfig>;
