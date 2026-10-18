import { Toolbar as KitToolbar, ZoomControl } from '@weasel-js/labkit';
import { Checkbox } from '@weasel-js/ui/components/Checkbox';
import { NumberField } from '@weasel-js/ui/components/NumberField';
import { Select } from '@weasel-js/ui/components/Select';
import { Icon } from '@weasel-js/ui';
import { icon } from './icons';
import { TAPE_SIZES, type TapeSize } from './label';
import { PrinterStatusChip, type PrinterStatusChipProps } from './PrinterStatusChip';
import './toolbar.css';

const TAPE_OPTIONS = Object.entries(TAPE_SIZES).map(([key, val]) => ({
  value: key as TapeSize,
  label: val.displayName,
}));

interface ToolbarProps {
  tapeSize: TapeSize;
  onTapeSizeChange: (size: TapeSize) => void;
  /** When on, labelLength is fitted to the content and the field is read-only. */
  autoLength: boolean;
  onAutoLengthChange: (auto: boolean) => void;
  labelLength: number;
  onLabelLengthChange: (len: number) => void;
  /** Segment count for the strip: N labels = N-1 evenly spaced cuts. */
  labelsCount: number;
  onLabelsCountChange: (n: number) => void;
  onExport: () => void;
  onImport: () => void;
  onPrint: () => void;
  printDisabled?: boolean;
  /** As a scale factor: 1 is 100%. */
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomSet: (zoom: number) => void;
  onZoomFit: () => void;
  onZoomReset: () => void;
  printerLastSeen: PrinterStatusChipProps['lastSeen'];
  printerReachable: boolean;
  onPrinterRefresh: () => void;
  onOpenPrefs: () => void;
}

export function Toolbar(props: ToolbarProps) {
  return (
    <KitToolbar aria-label="Document">
      <KitToolbar.Group aria-label="Tape">
        <Select<TapeSize>
          aria-label="Tape"
          width="fit"
          selectedKey={props.tapeSize}
          onSelectionChange={props.onTapeSizeChange}
          options={TAPE_OPTIONS}
        />
        <span title="Fit the label length to the content, the way P-touch's auto length does">
          <Checkbox isSelected={props.autoLength} onChange={props.onAutoLengthChange}>
            Auto length
          </Checkbox>
        </span>
        <NumberField
          label="Length (pt)"
          orientation="row"
          width="fit"
          hideSteppers
          className="toolbar__length"
          // Fitted lengths carry float noise (145.39999…); show one decimal.
          formatOptions={{ maximumFractionDigits: 1 }}
          minValue={1}
          value={props.labelLength}
          onChange={(v) => Number.isFinite(v) && props.onLabelLengthChange(v)}
          isDisabled={props.autoLength}
        />
        <span title="Cut the strip into this many equal labels when printing">
          <NumberField
            label="Labels"
            orientation="row"
            width="fit"
            hideSteppers
            className="toolbar__labels"
            minValue={1}
            maxValue={50}
            step={1}
            value={props.labelsCount}
            onChange={(v) => Number.isFinite(v) && props.onLabelsCountChange(v)}
          />
        </span>
      </KitToolbar.Group>
      <KitToolbar.Group aria-label="Zoom">
        <KitToolbar.Button iconOnly aria-label="Zoom out" title="Zoom out" onClick={props.onZoomOut}>
          <Icon name={icon('ui:zoomOut')} />
        </KitToolbar.Button>
        <ZoomControl zoom={props.zoom} onZoomChange={props.onZoomSet} />
        <KitToolbar.Button iconOnly aria-label="Zoom in" title="Zoom in" onClick={props.onZoomIn}>
          <Icon name={icon('ui:zoomIn')} />
        </KitToolbar.Button>
        <KitToolbar.Button iconOnly aria-label="Zoom to fit" title="Zoom to fit" onClick={props.onZoomFit}>
          <Icon name={icon('ui:fit')} />
        </KitToolbar.Button>
        <KitToolbar.Button
          iconOnly
          aria-label="Reset to 100%"
          title="Reset to 100%, centered"
          onClick={props.onZoomReset}
        >
          <Icon name={icon('ui:reset')} />
        </KitToolbar.Button>
      </KitToolbar.Group>
      <KitToolbar.Group end aria-label="File">
        <PrinterStatusChip
          lastSeen={props.printerLastSeen}
          reachable={props.printerReachable}
          printing={props.printDisabled ?? false}
          onRefresh={props.onPrinterRefresh}
        />
        <KitToolbar.Button onClick={props.onImport}>
          <Icon name={icon('ui:open')} size={16} /> Open .lbx
        </KitToolbar.Button>
        <KitToolbar.Button onClick={props.onExport}>
          <Icon name={icon('ui:export')} size={16} /> Export .lbx
        </KitToolbar.Button>
        <KitToolbar.Button onClick={props.onPrint} disabled={props.printDisabled} title="Print to label printer">
          Print
        </KitToolbar.Button>
        <KitToolbar.Button iconOnly aria-label="Preferences" title="Preferences" onClick={props.onOpenPrefs}>
          <Icon name={icon('ui:settings')} />
        </KitToolbar.Button>
      </KitToolbar.Group>
    </KitToolbar>
  );
}
