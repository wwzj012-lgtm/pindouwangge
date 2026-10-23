import { describe, expect, it } from 'vitest';
import { selectPerceptualPalette } from './perceptualPalette';

const candidates=[0,2,4,70,95].map((value,index)=>({color:{id:String(index)},lab:[value,0,0] as [number,number,number]}));
const distance=(a:[number,number,number],b:typeof candidates[number])=>Math.abs(a[0]-b.lab[0]);
describe('perceptual colour budget',()=>{
  it('does not trade away explicitly protected source-supported contour colours',()=>{
    const samples=[{lab:[95,0,0] as [number,number,number],weight:1000},{lab:[70,0,0] as [number,number,number],weight:1000},{lab:[0,0,0] as [number,number,number],weight:2}];
    const result=selectPerceptualPalette(candidates,samples,2,distance,['4','3'],['0']);
    expect(result.map(c=>c.color.id)).toContain('0');
    expect(result).toHaveLength(2);
  });
  it('spends a slot on a distinct small region instead of redundant background shades',()=>{
    const samples=[{lab:[0,0,0] as [number,number,number],weight:50},{lab:[2,0,0] as [number,number,number],weight:45},{lab:[95,0,0] as [number,number,number],weight:5}];
    const selected=selectPerceptualPalette(candidates,samples,2,distance,['0','1']);
    expect(selected.map(c=>c.color.id)).toContain('4');
    expect(selected).toHaveLength(2);
    expect(selected.every(c=>candidates.includes(c))).toBe(true);
  });
  it('is deterministic and cannot increase weighted reconstruction cost over the old frequency baseline',()=>{
    for(let seed=1;seed<=12;seed++){
      const samples=Array.from({length:37},(_,i)=>({lab:[(i*seed*17)%100,0,0] as [number,number,number],weight:1+(i*seed)%9}));
      const before=['0','1','2'];
      const result=selectPerceptualPalette(candidates,samples,3,distance,before);
      const error=(entries:typeof candidates)=>samples.reduce((total,s)=>total+s.weight*Math.min(...entries.map(e=>distance(s.lab,e)**2)),0);
      expect(error(result)).toBeLessThanOrEqual(error(candidates.filter(c=>before.includes(c.color.id)))+1e-8);
      expect(selectPerceptualPalette(candidates,samples,3,distance,before)).toEqual(result);
      expect(result).toHaveLength(3);
    }
  });
  it('preserves input samples and candidate ordering and handles an empty raster',()=>{
    const samples=[{lab:[70,0,0] as [number,number,number],weight:10}];
    const before=structuredClone({samples,candidates});
    const result=selectPerceptualPalette(candidates,samples,1,distance,['0']);
    expect(result.map(c=>c.color.id)).toEqual(['3']);
    expect({samples,candidates}).toEqual(before);
    expect(selectPerceptualPalette(candidates,[],2,distance,[])).toEqual([]);
  });
});
