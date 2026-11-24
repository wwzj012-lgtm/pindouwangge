// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildXlsx, parseXlsx, zipStore, unzip } from './xlsx';

describe('xlsx 引擎（零依赖）', () => {
  it('zipStore/unzip 往返：stored 条目原样还原', async () => {
    const payload = new TextEncoder().encode('<hello>世界</hello>');
    const zip = zipStore([{ name: 'a/test.xml', data: payload }, { name: 'b.txt', data: new Uint8Array([1, 2, 3]) }]);
    const entries = await unzip(zip);
    expect([...entries.keys()].sort()).toEqual(['a/test.xml', 'b.txt']);
    expect(new TextDecoder().decode(entries.get('a/test.xml')!)).toBe('<hello>世界</hello>');
    expect([...entries.get('b.txt')!]).toEqual([1, 2, 3]);
  });

  it('buildXlsx → parseXlsx 往返：中文/数字/多行', async () => {
    const xlsx = buildXlsx([{
      name: '库存',
      rows: [
        ['色号', '名称', '数量'].map(value => ({ value, style: 1 })),
        [{ value: 'A1' }, { value: '奶白 · 特白' }, { value: 215 }],
        [{ value: 'H7' }, { value: '深灰' }, { value: 433 }],
      ],
      columnWidths: [12, 24, 8],
    }]);
    const grid = await parseXlsx(xlsx);
    expect(grid.length).toBe(3);
    expect(grid[0]).toEqual(['色号', '名称', '数量']);
    expect(grid[1]).toEqual(['A1', '奶白 · 特白', 215]);
    expect(grid[2]).toEqual(['H7', '深灰', 433]);
  });

  it('特殊字符转义：& < > 引号不被 XML 破坏', async () => {
    const xlsx = buildXlsx([{ name: 'S', rows: [[{ value: 'A&B <测试>"引\'号' }]] }]);
    const grid = await parseXlsx(xlsx);
    expect(grid[0][0]).toBe('A&B <测试>"引\'号');
  });
});
