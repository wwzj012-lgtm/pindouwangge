import { describe, expect, it } from 'vitest';
import { alignGridToSize, clearConnectedColorRegion, flipGrid, normalizeSymmetryAxes, reflectGridPoints } from './gridEditing';

describe('canvas region and mirror editing', () => {
  it('clears only an orthogonally connected same-color region without mutating source', () => {
    const grid = [['r','r',null,'r'],[null,'b','r',null]];
    expect(clearConnectedColorRegion(grid,0,0)).toEqual([[null,null,null,'r'],[null,'b','r',null]]);
    expect(grid[0][0]).toBe('r');
    expect(clearConnectedColorRegion(grid,2,0)).toBe(grid);
  });
  it('returns independent full-grid horizontal and vertical flips', () => {
    const grid = [['a',null,'b'],['c','d',null]];
    expect(flipGrid(grid,'horizontal')).toEqual([['b',null,'a'],[null,'d','c']]);
    expect(flipGrid(grid,'vertical')).toEqual([['c','d',null],['a',null,'b']]);
    expect(flipGrid(flipGrid(grid,'horizontal'),'horizontal')).toEqual(grid);
  });
  it('clears a large contiguous board iteratively and handles ragged rows', () => {
    const large = Array.from({length:312}, () => Array(312).fill('r'));
    const result = clearConnectedColorRegion(large,0,0);
    expect(result.every(row => row.every(cell => cell === null))).toBe(true);
    expect(large[311][311]).toBe('r');
    expect(clearConnectedColorRegion([['r','r'],[],['r']],0,0)).toEqual([[null,null],[],['r']]);
  });
  it('preserves center symmetry and supports axes through cells and between cells', () => {
    expect(reflectGridPoints([{x:0,y:1}],'horizontal',8,6)).toEqual([{x:0,y:1},{x:7,y:1}]);
    expect(reflectGridPoints([{x:0,y:1}],'horizontal',8,6,{x:2.5,y:3})).toEqual([{x:0,y:1},{x:4,y:1}]);
    expect(reflectGridPoints([{x:1,y:1}],'quad',8,6,{x:2,y:2})).toHaveLength(4);
  });
  it('drops out-of-board reflections and deduplicates points on the axis', () => {
    expect(reflectGridPoints([{x:6,y:1}],'horizontal',8,6,{x:1,y:3})).toEqual([{x:6,y:1}]);
    expect(reflectGridPoints([{x:2,y:1}],'horizontal',8,6,{x:2.5,y:3})).toHaveLength(1);
    expect(normalizeSymmetryAxes({x:99,y:-5},8,6)).toEqual({x:8,y:0});
  });
});

describe('alignGridToSize keeps grid data in sync with canvas dimensions', () => {
  it('pads columns on the right by default and normalizes undefined holes', () => {
    const grid: (string | null)[][] = [['a','b'],[undefined as unknown as string,'d']];
    expect(alignGridToSize(grid, 4, 2)).toEqual([['a','b',null,null],[null,'d',null,null]]);
  });

  it('pads columns on the left when the expand side is left (用户要的左边加列)', () => {
    const grid = [['a','b','c'],['d','e','f']];
    expect(alignGridToSize(grid, 4, 2, 'left')).toEqual([[null,'a','b','c'],[null,'d','e','f']]);
  });

  it('trims from the anchored side when shrinking width', () => {
    const grid = [['a','b','c'],['d','e','f']];
    expect(alignGridToSize(grid, 2, 2, 'right')).toEqual([['a','b'],['d','e']]);
    expect(alignGridToSize(grid, 2, 2, 'left')).toEqual([['b','c'],['e','f']]);
  });

  it('pads missing rows at the bottom and trims extra rows', () => {
    const grid = [['a','b']];
    expect(alignGridToSize(grid, 2, 3)).toEqual([['a','b'],[null,null],[null,null]]);
    expect(alignGridToSize([['a','b'],['c','d'],['e','f']], 2, 2)).toEqual([['a','b'],['c','d']]);
  });

  it('treats absent rows as empty and never returns ragged rows', () => {
    // 'left' = 新列插在左边，原有内容向右对齐：长度 1 的行加宽到 3 后内容落在最右。
    const result = alignGridToSize([[], ['a']], 3, 3, 'left');
    expect(result).toEqual([[null,null,null],[null,null,'a'],[null,null,null]]);
    expect(result.every(row => row.length === 3)).toBe(true);
  });
});
