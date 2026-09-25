import { describe, expect, it } from 'vitest';
import { fetchAllRows, PAGE_SIZE } from '../fetchAllRows';

const source = Array.from({ length: 2 * PAGE_SIZE + 17 }, (_, i) => i);
const pager = (calls: Array<[number, number]>) => (from: number, to: number) => {
  calls.push([from, to]);
  return Promise.resolve({ data: source.slice(from, to + 1), error: null });
};

describe('fetchAllRows', () => {
  it('reads every page until a short one', async () => {
    const calls: Array<[number, number]> = [];
    const rows = await fetchAllRows(pager(calls));
    expect(rows).toHaveLength(source.length);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('stops at the max', async () => {
    const rows = await fetchAllRows(pager([]), PAGE_SIZE);
    expect(rows).toHaveLength(PAGE_SIZE);
  });

  it('throws on error', async () => {
    await expect(fetchAllRows(() => Promise.resolve({ data: null, error: { message: 'boom' } }))).rejects.toThrow('boom');
  });
});
