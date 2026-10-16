import { StatusBar, StatusBarItem, StatusBarSpacer } from '@weasel-js/ui/components/StatusBar';
import { useCursor, type CursorStore } from './cursorStore';
import { usePrinterSummary, type PrinterSeen } from './printerStatus';
import './editorStatusBar.css';

const MM_PER_PT = 25.4 / 72;

interface EditorStatusBarProps {
  activeTool: string | null;
  selectedCount: number;
  cursor: CursorStore;
  printerLastSeen: PrinterSeen | null;
  printerReachable: boolean;
  printing: boolean;
  zoomPercent: number;
}

function mm(pt: number): string {
  return (pt * MM_PER_PT).toFixed(1);
}

function CursorReadout({ cursor }: { cursor: CursorStore }) {
  const point = useCursor(cursor);
  return (
    <StatusBarItem className="editor-status__cursor">
      {point ? `x ${mm(point.x)} mm · y ${mm(point.y)} mm` : 'x — · y —'}
    </StatusBarItem>
  );
}

export function EditorStatusBar(props: EditorStatusBarProps) {
  const printer = usePrinterSummary(props.printerLastSeen, props.printerReachable, props.printing);
  return (
    <StatusBar ariaLabel="Editor status" divided className="editor-status">
      <StatusBarItem>tool: {props.activeTool ?? '—'}</StatusBarItem>
      <StatusBarItem className="editor-status__selection">
        {props.selectedCount === 0 ? 'nothing selected' : `${props.selectedCount} selected`}
      </StatusBarItem>
      <CursorReadout cursor={props.cursor} />
      <StatusBarSpacer />
      <StatusBarItem title={printer.tooltip}>{printer.text}</StatusBarItem>
      <StatusBarItem className="editor-status__zoom">zoom {props.zoomPercent}%</StatusBarItem>
    </StatusBar>
  );
}
