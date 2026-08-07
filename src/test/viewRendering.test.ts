import * as assert from 'assert';
import {
  createSingleViewRenderPlan,
  getStoredSortDirective,
} from '../utils/viewRendering';

suite('single-view rendering', () => {
  test('renders only the active view and clears every hidden view', () => {
    assert.deepStrictEqual(
      createSingleViewRenderPlan(['classic', 'table'] as const, 'classic'),
      {
        render: 'classic',
        clear: ['table'],
      }
    );
  });

  test('updates the plan when the active view changes', () => {
    assert.deepStrictEqual(
      createSingleViewRenderPlan(['classic', 'table'] as const, 'table'),
      {
        render: 'table',
        clear: ['classic'],
      }
    );
  });

  test('restores an active sort after the table is rendered again', () => {
    assert.deepStrictEqual(
      getStoredSortDirective({ field: 'size', isAscending: false }),
      { field: 'size', isAscending: false }
    );
  });

  test('does not request sorting when the original order is active', () => {
    assert.strictEqual(
      getStoredSortDirective({ field: null, isAscending: true }),
      undefined
    );
  });
});
