/**
 * Runs `fn` over `items` with at most `concurrency` in flight at once, preserving
 * per-item ordering isn't guaranteed but all items are always processed exactly
 * once. Used to speed up bulk DB operations (CSV import, bulk contact actions)
 * that would otherwise be too slow sequentially for a serverless function's
 * execution time limit, without overwhelming the DB connection pool.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T, index);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
