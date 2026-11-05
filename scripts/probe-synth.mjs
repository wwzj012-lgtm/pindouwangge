import { createServer } from 'vite';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { rgbToLab, deltaE76 } = await vite.ssrLoadModule('/src/utils/imagePipeline.ts');
function hslToRgb(h, s, l) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1/6) return p + (q-p)*6*t; if (t < 1/2) return q; if (t < 2/3) return p + (q-p)*(2/3-t)*6; return p; };
  return [Math.round(ch(h+1/3)*255), Math.round(ch(h)*255), Math.round(ch(h-1/3)*255)];
}
const S = 128;
const data = new Uint8ClampedArray(S * S * 4);
for (let i = 0; i < S * S; i++) { data[i*4]=245; data[i*4+1]=164; data[i*4+2]=72; data[i*4+3]=255; }
const set = (x, y, rgb) => { const o = (y * S + x) * 4; data[o]=rgb[0]; data[o+1]=rgb[1]; data[o+2]=rgb[2]; data[o+3]=255; };
const fills = [[242,242,242],[210,55,70],[70,140,220],[240,205,60]];
const bands = [];
for (let b = 0; b < 32; b++) bands.push(hslToRgb(b*11.25/360, 0.75, b%2===0?0.35:0.65));
for (let y = 8; y < 120; y++) for (let x = 8; x < 120; x++) {
  if (x >= 56 && y >= 10 && y < 74) continue;
  const outline = x===8||x===119||y===8||y===119;
  const fill = x < 64 ? (y < 64 ? fills[0] : fills[1]) : (y < 64 ? fills[2] : fills[3]);
  set(x, y, outline ? [12,12,16] : fill);
}
for (let y = 10; y < 74; y++) for (let x = 56; x < 88; x++) set(x, y, bands[Math.floor((y-10)/2)]);
// 分类逻辑
const stride = 1;
const clusters = [];
let sampled = 0;
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const o = (y*S+x)*4; sampled++;
  const lab = rgbToLab([data[o],data[o+1],data[o+2]]);
  let nearest=-1, nd=Infinity;
  for (let i=0;i<clusters.length;i++){const d=deltaE76(lab,clusters[i].lab);if(d<nd){nd=d;nearest=i;}}
  if (nearest>=0&&nd<=7){const c=clusters[nearest];c.lab=c.lab.map((v,k)=>(v*(c.count-1)+lab[k])/c.count);c.count++;}
  else if (clusters.length<64) clusters.push({lab,count:1});
  else if (nearest>=0) clusters[nearest].count++;
}
const sig = clusters.filter(c=>c.count/sampled>=0.003);
let flat=0,strong=0,dark=0,an=0;
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const o=(y*S+x)*4;
  const lab=rgbToLab([data[o],data[o+1],data[o+2]]);
  let nb=0,maxD=0,maxL=0;
  for (const [nx,ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]) {
    if (nx<0||nx>=S||ny<0||ny>=S) continue;
    const no=(ny*S+nx)*4;
    const nl=rgbToLab([data[no],data[no+1],data[no+2]]);
    nb++;maxD=Math.max(maxD,deltaE76(lab,nl));maxL=Math.max(maxL,Math.abs(lab[0]-nl[0]));
  }
  an++;
  if (maxD<=8) flat++;
  if (maxD>=22) strong++;
  if (lab[0]<=30&&maxL>=28&&maxD>=24) dark++;
}
console.log(`eff=${sig.length} flat=${(flat/an).toFixed(3)} strong=${(strong/an).toFixed(3)} dark=${(dark/an).toFixed(4)} analysed=${an}`);
await vite.close();
