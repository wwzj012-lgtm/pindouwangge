import { describe, expect, it } from 'vitest';
import { clearConnectedColorRegion, flipGrid, normalizeSymmetryAxes, reflectGridPoints } from './gridEditing';

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
