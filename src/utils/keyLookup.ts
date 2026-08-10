export function findByKey<T>(
  items: ArrayLike<T>,
  expectedKey: string,
  getKey: (item: T) => string | undefined
): T | undefined {
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (getKey(item) === expectedKey) {
      return item;
    }
  }
  return undefined;
}
