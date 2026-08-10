export interface TextSearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
}

const WORD_CHARACTER = /[a-zA-Z0-9_]/;

export function createTextMatcher(
  query: string,
  options: TextSearchOptions
): (text: string) => boolean {
  if (options.useRegex) {
    const flags = options.caseSensitive ? '' : 'i';
    const pattern = options.wholeWord ? `\\b${query}\\b` : query;
    const regex = new RegExp(pattern, flags);
    return (text: string) => regex.test(text);
  }

  const searchQuery = options.caseSensitive ? query : query.toLowerCase();
  if (!options.wholeWord) {
    return (text: string) => {
      const searchIn = options.caseSensitive ? text : text.toLowerCase();
      return searchIn.includes(searchQuery);
    };
  }

  return (text: string) => {
    const searchIn = options.caseSensitive ? text : text.toLowerCase();
    let index = searchIn.indexOf(searchQuery);
    while (index !== -1) {
      const before = index === 0 || !WORD_CHARACTER.test(searchIn[index - 1]);
      const end = index + searchQuery.length;
      const after = end >= searchIn.length || !WORD_CHARACTER.test(searchIn[end]);
      if (before && after) {
        return true;
      }
      index = searchIn.indexOf(searchQuery, index + 1);
    }
    return false;
  };
}
