import * as assert from 'assert';
import { createSingleViewRenderPlan } from '../utils/viewRendering';

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
});
