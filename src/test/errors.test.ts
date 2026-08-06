import * as assert from 'assert';
import { UserCancelledError } from '../utils/errors';

suite('user cancellation', () => {
  test('uses a distinct error type', () => {
    const error = new UserCancelledError('selection cancelled');
    assert.ok(error instanceof Error);
    assert.ok(error instanceof UserCancelledError);
    assert.strictEqual(error.name, 'UserCancelledError');
    assert.strictEqual(error.message, 'selection cancelled');
  });
});
