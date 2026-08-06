import * as assert from 'assert';
import {
  assertWorkspaceTrusted,
  WORKSPACE_TRUST_MESSAGE,
} from '../utils/workspaceTrust';

suite('workspace trust', () => {
  test('allows analysis in a trusted workspace', () => {
    assert.doesNotThrow(() => assertWorkspaceTrusted(true));
  });

  test('blocks analysis in an untrusted workspace with an actionable message', () => {
    assert.throws(
      () => assertWorkspaceTrusted(false),
      error => {
        assert.ok(error instanceof Error);
        assert.strictEqual(error.message, WORKSPACE_TRUST_MESSAGE);
        assert.match(error.message, /trust this workspace/i);
        assert.match(error.message, /objdump and nm/i);
        return true;
      }
    );
  });
});
