/** A deliberately bounded, 1 mm cell-center demonstration, not a machine verifier. */
export type ExampleMove = { kind: 'rapid' | 'cut'; from: [number, number, number]; to: [number, number, number] };
export type ExampleResult = { remaining: Uint8Array; missed: number; excess: number; rapidContacts: number[] };
export const STOCK = { x: 30, y: 20, z: 8, cell: 1 } as const;
export const EXAMPLE_MOVES: ExampleMove[] = [
  { kind: 'rapid', from: [5, 10, 12], to: [5, 10, 9] },
  { kind: 'cut', from: [5, 10, 9], to: [5, 10, 6] },
  { kind: 'cut', from: [5, 10, 6], to: [25, 10, 6] },
  { kind: 'rapid', from: [25, 10, 6], to: [25, 10, 12] },
];
const index = (x: number, y: number, z: number) => (z * STOCK.y + y) * STOCK.x + x;
const distanceToSlot = (x: number, y: number) => Math.hypot(x - Math.max(5, Math.min(25, x)), y - 10);

/** Only horizontal or vertical moves of the fixed example are accepted. */
export function simulateExample(radius: number, unsafeRapid = false): ExampleResult {
  if (!Number.isFinite(radius) || radius <= 0 || radius > 5) throw new Error('Tool radius must be in (0, 5] mm');
  const remaining = new Uint8Array(STOCK.x * STOCK.y * STOCK.z).fill(1);
  const moves = EXAMPLE_MOVES.map((move, i) => i === 0 && unsafeRapid ? { ...move, to: [5, 10, 6] as [number, number, number] } : move);
  const rapidContacts: number[] = [];
  for (const [n, move] of moves.entries()) {
    const [ax, ay, az] = move.from, [bx, by, bz] = move.to;
    const vertical = ax === bx && ay === by, horizontal = az === bz;
    if (!vertical && !horizontal) throw new Error('Unsupported example move');
    let hit = false;
    for (let z = 0; z < STOCK.z; z++) for (let y = 0; y < STOCK.y; y++) for (let x = 0; x < STOCK.x; x++) {
      const cell = index(x, y, z); if (!remaining[cell]) continue;
      const px = x + .5, py = y + .5, pz = z + .5;
      const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
      const t = length2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2)) : 0;
      const distance = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      // The example cutter is an 8 mm long vertical flat-ended cylinder.
      const bottom = Math.min(az, bz), top = Math.max(az, bz) + 8;
      if (distance <= radius && pz >= bottom && pz <= top) {
        if (move.kind === 'rapid') hit = true; else remaining[cell] = 0;
      }
    }
    if (hit) { rapidContacts.push(n + 1); break; }
  }
  let missed = 0, excess = 0;
  for (let z = 0; z < STOCK.z; z++) for (let y = 0; y < STOCK.y; y++) for (let x = 0; x < STOCK.x; x++) {
    const expectedRemoved = z + .5 >= 6 && distanceToSlot(x + .5, y + .5) <= 2;
    const removed = !remaining[index(x, y, z)];
    if (expectedRemoved && !removed) missed++;
    if (!expectedRemoved && removed) excess++;
  }
  return { remaining, missed, excess, rapidContacts };
}
