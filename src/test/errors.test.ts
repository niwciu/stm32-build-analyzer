import * as assert from 'assert';
import {
  AnalysisCancelledError,
  UserCancelledError,
} from '../utils/errors';

suite('user cancellation', () => {
  test('uses a distinct error type', () => {
    const error = new UserCancelledError('selection cancelled');
    assert.ok(error instanceof Error);
    assert.ok(error instanceof UserCancelledError);
    assert.strictEqual(error.name, 'UserCancelledError');
    assert.strictEqual(error.message, 'selection cancelled');
  });

  test('uses a distinct error type for superseded analysis', () => {
    const error = new AnalysisCancelledError();
    assert.ok(error instanceof AnalysisCancelledError);
    assert.match(error.message, /superseded/i);
  });
});
