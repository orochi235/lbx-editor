import { useMemo } from 'react';
import { encodeCode128 } from './barcode/code128';

/**
 * Palette icon: a genuine Code 128 encoding of 1337, drawn by the same
 * encoder the tool inserts. Vector, so it stays a real barcode at any size —
 * scannable if you zoom in, barcode-shaped texture at palette size.
 */
export function BarcodeIcon() {
  const symbol = useMemo(() => encodeCode128('1337', { gs1: false }), []);
  if (!symbol.ok || symbol.kind !== '1d') return null;

  return (
    <svg
      width="20"
      height="20"
      viewBox={`0 0 ${symbol.totalModules} ${symbol.totalModules}`}
      fill="currentColor"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      {symbol.bars.map((bar) => (
        <rect
          key={bar.x}
          x={bar.x}
          y={symbol.totalModules * 0.1}
          width={bar.width}
          height={symbol.totalModules * 0.8}
        />
      ))}
    </svg>
  );
}
