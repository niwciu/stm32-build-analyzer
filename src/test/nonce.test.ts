import * as assert from 'assert';
import { createNonce } from '../utils/nonce';

suite('CSP nonce', () => {
  test('creates a 128-bit hexadecimal nonce', () => {
    assert.match(createNonce(), /^[0-9a-f]{32}$/);
  });

  test('does not reuse nonces across generated webviews', () => {
    const nonces = new Set(Array.from({ length: 32 }, () => createNonce()));
    assert.strictEqual(nonces.size, 32);
  });
});
