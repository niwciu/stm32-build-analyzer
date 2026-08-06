import * as assert from 'assert';
import {
  calculateUsagePercent,
  clampProgressPercent,
} from '../utils/usage';

suite('memory usage percentages', () => {
  test('calculates a normal percentage', () => {
    assert.strictEqual(calculateUsagePercent(25, 100), 25);
  });

  test('returns zero for a zero-sized region', () => {
    assert.strictEqual(calculateUsagePercent(10, 0), 0);
  });

  test('returns zero for non-finite input', () => {
    assert.strictEqual(calculateUsagePercent(Number.NaN, 100), 0);
    assert.strictEqual(calculateUsagePercent(10, Number.POSITIVE_INFINITY), 0);
  });

  test('preserves over-capacity usage for the displayed value', () => {
    assert.strictEqual(calculateUsagePercent(150, 100), 150);
  });

  test('clamps progress-bar width to its visual bounds', () => {
    assert.strictEqual(clampProgressPercent(150), 100);
    assert.strictEqual(clampProgressPercent(-10), 0);
    assert.strictEqual(clampProgressPercent(Number.NaN), 0);
  });
});
