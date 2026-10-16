import type { ComponentProps } from 'react';
import type { Scene, SelectionApi } from '@weasel-js/core';
import { Sidebar } from '@weasel-js/ui/components/Sidebar';
import type { LabelLayer, LabelNodeData, LabelPose } from './label';
import { InspectorPanel } from './InspectorPanel';
import { PropertyPanel } from './PropertyPanel';
import { ArrangePanel } from './ArrangePanel';
import { LayersPanel } from './LayersPanel';
import { PrinterPanel } from './PrinterPanel';
import { DebugPanel } from './DebugPanel';
import { CustomFontsPanel } from './CustomFontsPanel';
import './inspector.css';

interface InspectorProps {
  scene: Scene<LabelNodeData, LabelLayer, LabelPose>;
  selection: SelectionApi;
  labelRect: LabelPose;
  printer: ComponentProps<typeof PrinterPanel>;
  debug: ComponentProps<typeof DebugPanel>;
}

/** The right-hand column: one collapsible panel per concern. */
export function Inspector({ scene, selection, labelRect, printer, debug }: InspectorProps) {
  return (
    <Sidebar side="right" ariaLabel="Inspector" className="inspector">
      <InspectorPanel id="properties" title="Properties">
        <PropertyPanel scene={scene} selection={selection} />
      </InspectorPanel>
      <InspectorPanel id="arrange" title="Arrange">
        <ArrangePanel scene={scene} selection={selection} labelRect={labelRect} />
      </InspectorPanel>
      <InspectorPanel id="layers" title="Layers">
        <LayersPanel scene={scene} selection={selection} />
      </InspectorPanel>
      <InspectorPanel id="printer" title="Printer">
        <PrinterPanel {...printer} />
      </InspectorPanel>
      <InspectorPanel id="debug" title="Debug" defaultCollapsed>
        <DebugPanel {...debug} />
      </InspectorPanel>
      <InspectorPanel id="fonts" title="Custom fonts">
        <CustomFontsPanel />
      </InspectorPanel>
    </Sidebar>
  );
}
