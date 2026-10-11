export interface MapLabelAnchor { id: string; x: number; y: number }
export interface MapLabelPlacement extends MapLabelAnchor { left: number; top: number }

/** Screen-space labels only: source coordinates and lot identities never change. */
export function placeParkingLabels(anchors: MapLabelAnchor[], width: number, height: number, selectedId?: string | null) {
  const labelWidth = Math.min(164, Math.max(100, width - 32));
  const labelHeight = 48;
  const placed: MapLabelPlacement[] = [];
  const visible = anchors.filter(p => p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height);
  const ordered = [...visible].sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId) || a.y - b.y || a.id.localeCompare(b.id));
  for (const anchor of ordered) {
    const candidates: { left: number; top: number; distance: number }[] = [];
    for (let top = 8; top + labelHeight <= height - 42; top += 54) {
      for (let left = 8; left + labelWidth <= width - 8; left += 12) {
        const right = left + labelWidth, bottom = top + labelHeight;
        // Keep the bottom-right navigation and bottom-left overflow action usable.
        if (right > width - 48 && bottom > height - 145) continue;
        if (left < Math.min(230, width - 48) && bottom > height - 94) continue;
        if (placed.some(p => left < p.left + labelWidth + 6 && right + 6 > p.left && top < p.top + labelHeight + 6 && bottom + 6 > p.top)) continue;
        if (visible.some(p => p.x > left - 10 && p.x < right + 10 && p.y > top - 10 && p.y < bottom + 10)) continue;
        candidates.push({ left, top, distance: Math.hypot(left + labelWidth / 2 - anchor.x, top + labelHeight / 2 - anchor.y) });
      }
    }
    candidates.sort((a, b) => a.distance - b.distance || a.left - b.left);
    if (candidates[0]) placed.push({ ...anchor, left: candidates[0].left, top: candidates[0].top });
  }
  return { placements: placed, labelWidth, labelHeight, hiddenCount: visible.length - placed.length };
}
