import { useCallback, useState, useSyncExternalStore } from 'react';
import {
  SceneCanvas,
  useScene,
  useSelection,
  ActionsProvider,
  DepRegistryProvider,
  SelectionContextProvider,
  type ToolsApi,
} from '@weasel-js/core';
// Subpath imports (not the `@weasel-js/ui` barrel) so tsc/vite only pull in
// the modules we use, not sibling components like DataGrid that trip a
// duplicate-@types/react mismatch under this app's slightly newer React types.
import { ToolPalette } from '@weasel-js/ui/components/ToolPalette';
import { PrefsDialog } from '@weasel-js/ui/components/Prefs';
import { ToastRegion } from '@weasel-js/ui/components/Toast';
import { LabShell } from '@weasel-js/labkit';
import type { LabelNodeData, LabelLayer, LabelPose } from './label';
import { PALETTE_GROUP_ORDER } from './toolGroups';
import { PREFS_SCHEMA } from './prefs';
import { Toolbar } from './Toolbar';
import { Inspector } from './Inspector';
import { EditorStatusBar } from './EditorStatusBar';
import { DiagnosticCallout } from './DiagnosticCallout';
import { useCanvasCursor } from './cursorStore';
import { useLabelConfig } from './useLabelConfig';
import { useAutosave } from './useAutosave';
import { useCanvasView } from './useCanvasView';
import { useCanvasLayers } from './useCanvasLayers';
import { useEditorPrefs } from './useEditorPrefs';
import { usePrinterSession } from './usePrinterSession';
import { useCassetteColors } from './useCassetteColors';
import { useDocumentChecks } from './useDocumentChecks';
import { usePrintPreview } from './usePrintPreview';
import { usePrintJob } from './usePrintJob';
import { useLabelTools } from './useLabelTools';
import { useImagePicker } from './useImagePicker';
import { useLabelFiles } from './useLabelFiles';
import './app.css';

export function App() {
  // Declared up here because the label length derives from the scene contents
  // under auto-length, and everything below reads that length.
  const scene = useScene<LabelNodeData, LabelLayer, LabelPose>({
    systemLayers: [{ id: 'objects' as LabelLayer }],
  });
  const sceneVersion = useSyncExternalStore(
    useCallback((cb: () => void) => scene.subscribe(cb), [scene]),
    () => scene.getVersion(),
  );
  const selection = useSelection({ mode: 'multi' });

  const config = useLabelConfig(scene, sceneVersion);
  const {
    tapeSize, setTapeSize, autoLength, handleAutoLengthChange, setManualLength,
    cutMarks, handleLabelsCountChange, labelLength, paperHeight, printableBand,
  } = config;
  // The "paper" is the tape, drawn landscape: the label length is its width.
  const paperWidth = labelLength;

  const {
    canvasContainerRef, helpersRef, canvasSize, canvasMounted, displayLength, view, setView, viewRef,
    zoom, handleZoomIn, handleZoomOut, handleZoomSet, handleZoomFit, handleZoomReset,
  } = useCanvasView({ scene, autoLength, paperWidth, paperHeight });

  useAutosave(scene, sceneVersion, config);

  const prefs = useEditorPrefs();
  const {
    autoCut, cassetteColorsEnabled, documentWarnings, marginGuides,
    preflightChecks, printPreview, ditherAlgorithm,
  } = prefs;
  const [prefsOpen, setPrefsOpen] = useState(false);

  const { printerRef, printerLastSeen, printerReachable, handlePrinterRefresh } = usePrinterSession();
  const liveStatus = printerReachable ? (printerLastSeen?.status ?? null) : null;
  const cassette = useCassetteColors(cassetteColorsEnabled, liveStatus);
  const { tapeCss, tapeClear, inkCss } = cassette;

  const checks = useDocumentChecks({
    enabled: documentWarnings, scene, sceneVersion, tapeSize, labelLength, printableBand,
    view, canvasSize, canvasContainerRef,
  });

  const previewBitmap = usePrintPreview({
    enabled: printPreview, scene, sceneVersion, tapeSize, labelLength, paperHeight, inkCss, ditherAlgorithm,
  });

  const { printing, handlePrint } = usePrintJob({
    printerRef, scene, tapeSize, labelLength, paperHeight, autoCut, ditherAlgorithm, cutMarks,
    preflightChecks,
    // Re-raise every dismissed callout: the job is being refused over a
    // problem the user may have waved away, so put it back on the object.
    onBlocked: checks.reraiseAll,
  });

  const layers = useCanvasLayers({
    displayLength, paperWidth, paperHeight, tapeCss, tapeClear, inkCss, previewBitmap, printableBand,
    cutMarks, marginGuides,
  });

  // The live ToolsApi that drives the palette, handed over by SceneCanvas.
  const [tools, setTools] = useState<ToolsApi | null>(null);
  const { pendingImageRef, imageInputRef, handleImagePick } = useImagePicker(tools, paperWidth, paperHeight);
  const { toolsPatch, insertNodeFactories, resizeBehaviors } = useLabelTools(scene, pendingImageRef);

  const files = useLabelFiles({ scene, selection, config, paperWidth, paperHeight });

  // Pointer position in label points, for the status bar.
  const { cursor, handlePointerMove, handlePointerLeave } = useCanvasCursor(viewRef);

  return (
    <DepRegistryProvider>
      <ActionsProvider>
        <SelectionContextProvider>
          <LabShell
            title="Label Editor"
            mode="auto"
            header={
              <Toolbar
                tapeSize={tapeSize}
                onTapeSizeChange={setTapeSize}
                autoLength={autoLength}
                onAutoLengthChange={handleAutoLengthChange}
                // The display value, so the readout tracks a drag in progress.
                // Safe in both modes: the field is disabled under Auto (pure
                // readout), and with Auto off the live hook is disabled, so this
                // is exactly `labelLength`.
                labelLength={displayLength}
                onLabelLengthChange={setManualLength}
                labelsCount={cutMarks.length + 1}
                onLabelsCountChange={handleLabelsCountChange}
                onExport={files.handleExport}
                onImport={files.openFilePicker}
                onPrint={handlePrint}
                printDisabled={printing}
                zoom={zoom}
                onZoomIn={handleZoomIn}
                onZoomOut={handleZoomOut}
                onZoomSet={handleZoomSet}
                onZoomFit={handleZoomFit}
                onZoomReset={handleZoomReset}
                printerLastSeen={printerLastSeen}
                printerReachable={printerReachable}
                onPrinterRefresh={handlePrinterRefresh}
                onOpenPrefs={() => setPrefsOpen(true)}
              />
            }
            footer={
              <EditorStatusBar
                activeTool={tools?.active ?? null}
                selectedCount={selection.current.length}
                cursor={cursor}
                printerLastSeen={printerLastSeen}
                printerReachable={printerReachable}
                printing={printing}
                zoomPercent={Math.round(zoom * 100)}
              />
            }
          >
            <PrefsDialog
              isOpen={prefsOpen}
              onOpenChange={setPrefsOpen}
              schema={PREFS_SCHEMA}
              values={prefs.prefValues}
              onChange={prefs.handlePrefChange}
            />
            {/* Results of things the user just did — a print that failed, a
                file that wouldn't parse. Document problems get an anchored
                callout instead, since those have an object to point at. */}
            <ToastRegion />
            <input ref={files.fileInputRef} type="file" accept=".lbx" hidden onChange={files.handleImport} />
            <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={handleImagePick} />
            <div className="editor-body">
              {tools && (
                <div className="editor-tools">
                  <ToolPalette tools={tools} orientation="vertical" groupOrder={PALETTE_GROUP_ORDER} />
                </div>
              )}
              <div
                ref={canvasContainerRef}
                className="editor-canvas"
                onDrop={files.handleDrop}
                onDragOver={files.handleDragOver}
                onPointerMove={handlePointerMove}
                onPointerLeave={handlePointerLeave}
              >
                {canvasMounted && (
                  <SceneCanvas<LabelNodeData, LabelLayer, LabelPose>
                    width={canvasSize.width}
                    height={canvasSize.height}
                    scene={scene}
                    selection={selection}
                    // `pick` mounts the select tool. Every other palette tool
                    // is registered by `tools` below, where this app controls
                    // both their order and their grouping. Notably hand,
                    // whose patch entry replaces the one `view` brings.
                    features={['view', 'pick', 'move', 'resize', 'edit', 'arrange']}
                    tools={toolsPatch}
                    insertNodeFactories={insertNodeFactories}
                    onToolsCreated={setTools}
                    selectTool={{ rotate: false, resize: { behaviors: resizeBehaviors } }}
                    // `recenter` routes Cmd-0 through the same center-the-label
                    // view as the toolbar Reset button.
                    viewport={{ recenter: handleZoomReset }}
                    view={view}
                    onViewChange={setView}
                    helpersRef={helpersRef}
                    layers={layers}
                  />
                )}
                {/* Dismissable, but the dismissal only holds while the label
                    is being edited: a blocked print clears them all, so the
                    reason the job won't go is back in front of the user. */}
                {checks.active && checks.anchor && (
                  <DiagnosticCallout
                    diagnostic={checks.active}
                    anchorRect={checks.anchor}
                    total={checks.diagnostics.length}
                    onDismiss={checks.dismiss}
                  />
                )}
              </div>
              <Inspector
                scene={scene}
                selection={selection}
                labelRect={{ x: 0, y: printableBand.y, width: labelLength, height: printableBand.height }}
                printer={{
                  lastSeen: printerLastSeen,
                  reachable: printerReachable,
                  printing,
                  onRefresh: handlePrinterRefresh,
                  autoCut,
                  onAutoCutChange: prefs.handleAutoCutChange,
                  printPreview,
                  onPrintPreviewChange: prefs.handlePrintPreviewChange,
                  marginGuides,
                  onMarginGuidesChange: prefs.handleMarginGuidesChange,
                  ditherAlgorithm,
                  onDitherAlgorithmChange: prefs.handleDitherAlgorithmChange,
                }}
                debug={{
                  cassetteColorsEnabled,
                  onCassetteColorsEnabledChange: prefs.handleCassetteColorsChange,
                  tapeColorOverride: cassette.tapeColorOverride,
                  onTapeColorOverrideChange: cassette.setTapeColorOverride,
                  textColorOverride: cassette.textColorOverride,
                  onTextColorOverrideChange: cassette.setTextColorOverride,
                  liveStatus,
                }}
              />
            </div>
          </LabShell>
        </SelectionContextProvider>
      </ActionsProvider>
    </DepRegistryProvider>
  );
}
