import { describe, expect, it } from 'vitest';
import type { BeadColor, ConvertSettings } from '../types';
import { classifyImageColors, convertImageDataToGrid } from './imagePipeline';

const color=(id:string,rgb:[number,number,number]):BeadColor=>({id,code:id,name:id,rgb,hex:'#'+rgb.map(c=>c.toString(16).padStart(2,'0')).join(''),brand:'CUSTOM'});
const palette=[color('white',[248,248,248]),color('near-white',[232,232,232]),color('accent',[220,30,50])];
const settings:ConvertSettings={width:100,height:1,keepAspectRatio:false,brand:'CUSTOM',boardSize:26,dither:'none',colorLimit:2,brightness:0,contrast:0,saturation:0,transparentCutoff:128,sharpening:0,outlineBoost:false,chromaKeyColor:null,chromaKeyTolerance:20,pipelineOverride:'photo',kmeansClustering:false,quantizationStrength:0,colorMatchAlgo:'ciede2000'};
describe('limited-palette source fidelity',()=>{
  it('protects recurring source-dark details without inventing black contours on a bright image',()=>{
    const colours=[color('white',[248,248,248]),color('near-white',[232,232,232]),color('peach',[245,192,156]),color('red',[215,34,48]),color('ink',[20,20,20])];
    const data=new Uint8ClampedArray(400);
    for(let x=0;x<100;x++)data.set([...colours[x<35?0:x<60?1:x<85?2:x<97?3:4].rgb,255],x*4);
    const opts={...settings,colorLimit:3};
    const result=convertImageDataToGrid(data,100,1,opts,colours);
    expect(result.grid[0].slice(97)).toEqual(Array(3).fill('ink'));
    for(let x=97;x<100;x++)data.set([...colours[2].rgb,255],x*4);
    const bright=convertImageDataToGrid(data,100,1,opts,colours);
    expect(bright.grid.flat()).not.toContain('ink');
  });
  it('does not flatten a complex many-colour scene into the low-colour cartoon profile just because some regions are flat',()=>{
    const data=new Uint8ClampedArray(160*160*4);
    const fills=Array.from({length:64},(_,i)=>[40+(i%4)*60,40+(Math.floor(i/4)%4)*60,40+Math.floor(i/16)*60]);
    for(let y=0;y<160;y++)for(let x=0;x<160;x++){
      const id=Math.floor(y/20)*8+Math.floor(x/20);
      const ink=x%20===0||y%20===0;
      data.set([...(ink?[12,12,16]:fills[id]),255],(y*160+x)*4);
    }
    expect(classifyImageColors(data,160,160).effectiveColorCount).toBeGreaterThan(32);
    expect(classifyImageColors(data,160,160).pipeline).toBe('photo');
  });
  it('retains a continuous sub-cell logo stroke instead of deleting the entire stroke during majority sampling',()=>{
    const colours=[color('paper',[248,248,248]),color('ink',[20,20,20])];
    const data=new Uint8ClampedArray(120*120*4);
    for(let y=0;y<120;y++)for(let x=0;x<120;x++)data.set([...(y===58&&x>=12&&x<108?colours[1].rgb:colours[0].rgb),255],(y*120+x)*4);
    const opts={...settings,width:20,height:20,colorLimit:0,pipelineOverride:'logo' as const};
    const output=convertImageDataToGrid(data,120,120,opts,colours).grid;
    for(let x=2;x<18;x++)expect(output[9][x]).toBe('ink');
    expect(output[8].filter(id=>id==='ink')).toHaveLength(0);
    expect(output[10].filter(id=>id==='ink')).toHaveLength(0);
  });
  it.each(['logo','cartoon'] as const)('does not change a flat %s sample when its same-bin source colours are reversed', mode=>{
    const close=[color('darker',[225,225,225]),color('lighter',[239,239,239])];
    const a=new Uint8ClampedArray([225,225,225,255,239,239,239,255,239,239,239,255,239,239,239,255]);
    const b=new Uint8ClampedArray([239,239,239,255,239,239,239,255,239,239,239,255,225,225,225,255]);
    const opts={...settings,width:1,height:1,colorLimit:0,pipelineOverride:mode};
    const first=convertImageDataToGrid(a,4,1,opts,close);
    const reversed=convertImageDataToGrid(b,4,1,opts,close);
    expect(first.grid).toEqual(reversed.grid);
    expect(first.grid[0][0]).toBe('lighter');
  });
  it('preserves a small distinct accent instead of spending the budget on two nearly identical background colours',()=>{
    const data=new Uint8ClampedArray(400);
    for(let x=0;x<100;x++)data.set([...palette[x<50?0:x<95?1:2].rgb,255],x*4);
    const before=data.slice();
    const result=convertImageDataToGrid(data,100,1,settings,palette);
    expect(result.grid[0].slice(95)).toEqual(Array(5).fill('accent'));
    expect(new Set(result.grid.flat()).size).toBeLessThanOrEqual(2);
    expect(data).toEqual(before);
  });
  it('keeps an explicit one-colour budget and never introduces disabled colours',()=>{
    const data=new Uint8ClampedArray(400);
    for(let x=0;x<100;x++)data.set([...palette[x<95?0:2].rgb,255],x*4);
    const result=convertImageDataToGrid(data,100,1,{...settings,colorLimit:1},[...palette,{...color('disabled',[248,248,248]),enabled:false}]);
    expect(new Set(result.grid.flat())).toEqual(new Set(['white']));
  });
});
