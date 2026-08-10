export function calculateUsagePercent(used: number, capacity: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(capacity) || capacity <= 0) {
    return 0;
  }
  return Math.max(0, used / capacity * 100);
}

export function clampProgressPercent(percent: number): number {
  if (!Number.isFinite(percent)) {
    return 0;
  }
  return Math.min(100, Math.max(0, percent));
}
