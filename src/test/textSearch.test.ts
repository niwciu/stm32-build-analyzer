import * as assert from 'assert';
import { createTextMatcher } from '../utils/textSearch';

suite('text search matcher', () => {
  const wholeWord = {
    caseSensitive: false,
    wholeWord: true,
    useRegex: false,
  };

  test('finds a later whole-word occurrence after an embedded occurrence', () => {
    const matches = createTextMatcher('foo', wholeWord);
    assert.ok(matches('foobar foo'));
  });

  test('rejects text containing only embedded occurrences', () => {
    const matches = createTextMatcher('foo', wholeWord);
    assert.ok(!matches('foobar prefoo foo_bar'));
  });

  test('honors case-sensitive matching', () => {
    const matches = createTextMatcher('Foo', {
      ...wholeWord,
      caseSensitive: true,
    });
    assert.ok(matches('foo Foo'));
    assert.ok(!matches('foo FOO'));
  });

  test('supports regular expressions', () => {
    const matches = createTextMatcher('foo\\d+', {
      caseSensitive: false,
      wholeWord: false,
      useRegex: true,
    });
    assert.ok(matches('prefix FOO42 suffix'));
  });

  test('throws for an invalid regular expression', () => {
    assert.throws(
      () => createTextMatcher('[', {
        caseSensitive: false,
        wholeWord: false,
        useRegex: true,
      })
    );
  });
});
