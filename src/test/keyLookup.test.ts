import * as assert from 'assert';
import { findByKey } from '../utils/keyLookup';

suite('key lookup', () => {
  const items = [
    { key: 'plain' },
    { key: 'symbol:"quoted"[index]\\template<int>' },
  ];

  test('finds an exact plain key', () => {
    assert.strictEqual(
      findByKey(items, 'plain', item => item.key),
      items[0]
    );
  });

  test('finds keys containing CSS selector metacharacters', () => {
    assert.strictEqual(
      findByKey(
        items,
        'symbol:"quoted"[index]\\template<int>',
        item => item.key
      ),
      items[1]
    );
  });

  test('does not partially match another key', () => {
    assert.strictEqual(
      findByKey(items, 'symbol:"quoted"', item => item.key),
      undefined
    );
  });
});
