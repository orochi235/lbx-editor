import { Callout } from '@weasel-js/ui/components/Callout';
import type { Diagnostic } from './diagnostics';
import './diagnosticCallout.css';

interface DiagnosticCalloutProps {
  diagnostic: Diagnostic;
  anchorRect: { x: number; y: number; width: number; height: number };
  /** Every live finding, including `diagnostic`. */
  total: number;
  onDismiss: (d: Diagnostic) => void;
}

/** The one document-check finding currently shown, anchored over its object. */
export function DiagnosticCallout({ diagnostic, anchorRect, total, onDismiss }: DiagnosticCalloutProps) {
  return (
    <Callout
      isOpen
      className="diagnostic-callout"
      anchorRect={anchorRect}
      placement="top"
      stance={diagnostic.severity === 'error' ? 'danger' : 'important'}
      title={diagnostic.title}
      // Dismissal is ours: `isOpen` stays true while the finding
      // stands, and `onDismiss` — the × or Escape, never the
      // incidental close a non-modal popover does when a click
      // lands on the artwork — is what retires it.
      onDismiss={() => onDismiss(diagnostic)}
      shouldCloseOnInteractOutside={() => false}
      aria-label={diagnostic.title}
    >
      <p>{diagnostic.detail}</p>
      {total > 1 && (
        <p>
          {total - 1} other{' '}
          {total === 2 ? 'object needs' : 'objects need'} attention.
        </p>
      )}
    </Callout>
  );
}
