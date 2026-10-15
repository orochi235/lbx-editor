import type { AlignEdge, MatchDims } from './arrange';

// The kit ships align icons, but as @experimental; these stay ours until it
// publishes them.

const BARS: Record<AlignEdge, { line: string; bars: [number, number, number, number][] }> = {
  left: { line: 'M2 1v14', bars: [[3, 3, 9, 3], [3, 9, 6, 3]] },
  'center-x': { line: 'M8 1v14', bars: [[3, 3, 10, 3], [5, 9, 6, 3]] },
  right: { line: 'M14 1v14', bars: [[4, 3, 9, 3], [7, 9, 6, 3]] },
  top: { line: 'M1 2h14', bars: [[3, 3, 3, 9], [9, 3, 3, 6]] },
  'center-y': { line: 'M1 8h14', bars: [[3, 3, 3, 10], [9, 5, 3, 6]] },
  bottom: { line: 'M1 14h14', bars: [[3, 4, 3, 9], [9, 7, 3, 6]] },
};

export function AlignIcon({ edge }: { edge: AlignEdge }) {
  const { line, bars } = BARS[edge];
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d={line} stroke="currentColor" strokeWidth="1.5" />
      {bars.map(([x, y, w, h]) => (
        <rect key={`${x},${y}`} x={x} y={y} width={w} height={h} fill="currentColor" />
      ))}
    </svg>
  );
}

const MATCH_ARROWS: Record<MatchDims, string> = {
  width: 'M1 8h14M1 8l3-3M1 8l3 3M15 8l-3-3M15 8l-3 3',
  height: 'M8 1v14M8 1l-3 3M8 1l3 3M8 15l-3-3M8 15l3-3',
  both: 'M2 2l12 12M2 2v4M2 2h4M14 14v-4M14 14h-4',
};

export function MatchIcon({ dims }: { dims: MatchDims }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d={MATCH_ARROWS[dims]} stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}
