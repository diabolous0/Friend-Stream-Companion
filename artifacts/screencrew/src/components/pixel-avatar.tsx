// Deterministic 5x5 symmetric pixel identicon derived from a user id.
// No network, no state — same id always renders the same sprite.

const PALETTE = [
  ["#00e5ff", "#0a2230"], ["#ff5cd6", "#2a1230"], ["#00ff66", "#062012"],
  ["#ffab00", "#2a1d02"], ["#7c5cff", "#171132"], ["#ff3b6b", "#2a0a14"],
  ["#1e90ff", "#06182a"], ["#27ae60", "#06200f"],
];

// Simple deterministic hash → 32-bit unsigned int.
function hash(n: number): number {
  let h = (n + 1) * 2654435761;
  h ^= h >>> 15;
  h = (h * 2246822519) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}

export function PixelAvatar({
  userId,
  size = 36,
  square = false,
}: {
  userId: number;
  size?: number;
  square?: boolean;
}) {
  const h = hash(userId);
  const [fg, bg] = PALETTE[h % PALETTE.length];

  // 5 columns, mirror columns 0/1 onto 4/3 for symmetry → 15 decision bits.
  const grid = 5;
  const cells: boolean[] = [];
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const sx = x < 3 ? x : grid - 1 - x;
      const bit = (hash(userId * 31 + y * 5 + sx) >>> (sx + y)) & 1;
      cells.push(bit === 1);
    }
  }

  const unit = 100 / grid;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={`${square ? "rounded-sm" : "rounded-full"} select-none shrink-0`}
      style={{ background: bg }}
      shapeRendering="crispEdges"
      aria-hidden
    >
      {cells.map((on, i) =>
        on ? (
          <rect
            key={i}
            x={(i % grid) * unit}
            y={Math.floor(i / grid) * unit}
            width={unit}
            height={unit}
            fill={fg}
          />
        ) : null,
      )}
    </svg>
  );
}
