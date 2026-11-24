// 构建 card2 校对面板 v1（自包含 HTML，离线可开）。
// 基于 card1 面板已验证的结论：双字段校对、建议 chip 码+量一起填、构建时预填
// （localStorage 只当会话缓存）、导出弹窗+复制、筛选器走真实 onchange。
// card2 特有：3行×8列=24 槽规则网格；21 真值已知 + 3 槽水印遮挡待裁决（#16/#21/#23）；
// 管线输出按 dbg.items 的 x 回绕映射到槽位（card2 dbg.bands=[] 无 token 布局）。
// 用法：node scripts/build-card2-panel.mjs → benchmark/results/calib-panel-card2.html
process.chdir('D:/Build_Apps/pindouwangge');
const { createServer } = await import('vite');
const sharp = (await import('sharp')).default;
const fs = (await import('fs')).default;
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const IL = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');

const { data, info } = await sharp('benchmark/images/card2.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const native = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const r = IL.parseColorCard(native, BRAND_PALETTES.MARD);
const dbg = IL.debugColorCardParse(native);

// ---- 真值（round1 人工校对后修正：C20/2、#22=M3、#23=M14/12 新增）----
const TRUTH = [
  { code: 'A1', count: 23 }, { code: 'A17', count: 11 }, { code: 'B11', count: 9 }, { code: 'B14', count: 32 },
  { code: 'B25', count: 59 }, { code: 'B26', count: 12 }, { code: 'C10', count: 70 }, { code: 'C16', count: 56 },
  { code: 'C17', count: 7 }, { code: 'C19', count: 26 }, { code: 'C20', count: 2 }, { code: 'C22', count: 1 },
  { code: 'C24', count: 9 }, { code: 'C26', count: 1 }, { code: 'F6', count: 8 }, { code: 'H2', count: 106 },
  { code: null, count: null, note: '水印全遮挡（深灰票）' }, { code: 'H5', count: 36 }, { code: 'H6', count: 136 }, { code: 'H7', count: 433 },
  { code: 'M1', count: 16 }, { code: null, count: null, note: '水印全遮挡（绿票）' }, { code: 'M3', count: 2 }, { code: 'M14', count: 12 },
];
const N_KNOWN = TRUTH.filter(t => t.code).length; // 21

// ---- 管线 20 条目 → 槽位映射（x 回绕分行，col = floor(nx / (W/8))）----
const COLW = native.width / 8;
const pipeBySlot = {};
{
  let row = 0, prevX = -1;
  dbg.items.forEach((it, i) => {
    const cs = it.codeSpan && it.codeSpan !== '-' ? it.codeSpan : null;
    const ns = it.countSpan && it.countSpan !== '-' ? it.countSpan : null;
    if (!cs && !ns) return;
    const start = cs ? +cs.split('-')[0] : +ns.split('-')[0];
    const nx = start / 4;
    if (prevX >= 0 && nx < prevX - COLW / 2) row += 1;
    prevX = nx;
    const col = Math.min(7, Math.max(0, Math.floor(nx / COLW)));
    const slot = row * 8 + col;
    const e = r.entries[i] || {};
    pipeBySlot[slot] = {
      code: e.code || '', count: e.count ?? null,
      conf: e.confidence != null && Number.isFinite(e.confidence) ? +e.confidence.toFixed(2) : null,
      warn: e.warn || '', item: i,
    };
  });
}
console.log('pipe slot map:', Object.entries(pipeBySlot).map(([s, p]) => `#${s}:${p.code || '?'}/${p.count}`).join(' '));

const suggestions = JSON.parse(fs.readFileSync('benchmark/results/card2-suggestions.json', 'utf8'));

// 预填：round1 已入库的人工校对（localStorage 在预览沙箱里不可靠，构建时注入）
const prefill = {};
if (fs.existsSync('benchmark/results/card2-calibrated.json')) {
  const calib = JSON.parse(fs.readFileSync('benchmark/results/card2-calibrated.json', 'utf8'));
  for (const s of calib.slots) {
    if (s.final && s.final !== 'LIM') prefill[s.i] = { code: s.final.code, count: s.final.count ?? null, st: 'done', human: true };
    else if (s.final === 'LIM') prefill[s.i] = { st: 'lim', human: true };
  }
}

const slots = [];
for (let i = 0; i < 24; i += 1) {
  const t = TRUTH[i];
  const p = pipeBySlot[i] || { code: '', count: null, conf: null, warn: '未检出', item: -1 };
  const known = !!t.code;
  const isMiss = known && p.code !== t.code;
  const sug = suggestions[String(i)] || {};
  const dedupe = (arr) => {
    const seen = new Set();
    return arr.filter(x => {
      const k = x.text.toUpperCase().replace(/\s+/g, '');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  slots.push({
    i,
    truth: t,
    known,
    pipe: p,
    miss: isMiss,
    countSuspect: known && p.code === t.code && p.count !== t.count,
    sugC: dedupe((sug.c || []).slice(0, 10)).slice(0, 5),
    sugB: dedupe((sug.b || []).slice(0, 10)).slice(0, 5),
    sugD: sug.d ? sug.d.text : null,
    crop: null,
    prefill: prefill[i] || null,
  });
}
for (const s of slots) if (s.miss || s.countSuspect || !s.known) s.crop = await cropJpeg(s.i);

async function cropJpeg(slot) {
  const files = fs.readdirSync('benchmark/results/card2-crops').filter(f => f.startsWith(`slot-${String(slot).padStart(2, '0')}_`));
  if (!files.length) return null;
  const buf = await sharp(`benchmark/results/card2-crops/${files[0]}`).jpeg({ quality: 85 }).toBuffer();
  return 'data:image/jpeg;base64,' + buf.toString('base64');
}

// 全卡缩略图：3×8 网格框出漏项与遮挡槽
const ow = 1100;
const scale = ow / native.width;
const oh = Math.round(native.height * scale);
const rects = slots.filter(s => s.miss || !s.known).map(s => {
  const rr = Math.floor(s.i / 8), cc = s.i % 8;
  const bx = cc * COLW, by = rr * (native.height / 3);
  const color = s.known ? '#e33' : '#e8a000';
  return `<rect x="${Math.round(bx) + 1}" y="${Math.round(by) + 1}" width="${Math.round(COLW) - 2}" height="${Math.round(native.height / 3) - 2}" fill="none" stroke="${color}" stroke-width="2"/><text x="${Math.round(bx) + 4}" y="${Math.round(by) + 14}" font-size="11" fill="${color}" font-weight="bold">#${s.i}</text>`;
}).join('');
const overviewJpeg = 'data:image/jpeg;base64,' + (
  await sharp(native.data.buffer, { raw: { width: native.width, height: native.height, channels: 4 } })
    .resize(ow, oh)
    .composite([{ input: Buffer.from(`<svg width="${ow}" height="${oh}">${rects}</svg>`), top: 0, left: 0 }])
    .jpeg({ quality: 85 }).toBuffer()
).toString('base64');

await vite.close();

const payload = JSON.stringify({ slots, overviewJpeg, nKnown: N_KNOWN }).replace(/</g, '\\u003c');
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>拼豆色卡校对面板 · card2 · v1</title>
<style>
  :root { --bd:#ddd; --mut:#888; --bg:#fafafa; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", "Microsoft YaHei", sans-serif; margin: 0; background: var(--bg); color: #222; font-size: 13px; }
  header { position: sticky; top: 0; z-index: 10; background: #fff; border-bottom: 1px solid var(--bd); padding: 10px 16px; }
  h1 { font-size: 16px; margin: 0 0 6px; }
  .stats { display: flex; gap: 16px; flex-wrap: wrap; color: #555; }
  .stats b { color: #111; }
  main { padding: 12px 16px; }
  #overview { max-width: 1100px; width: 100%; border: 1px solid var(--bd); border-radius: 6px; display: block; margin-bottom: 14px; }
  table { border-collapse: collapse; width: 100%; background: #fff; }
  th, td { border: 1px solid var(--bd); padding: 5px 8px; vertical-align: top; text-align: left; }
  th { position: sticky; top: 88px; background: #f0f0f0; z-index: 5; font-size: 12px; }
  tr.miss td { background: #fff7f5; }
  tr.unknown td { background: #fffbf0; }
  tr.ok td { background: #f6fff6; }
  .code { font-family: Consolas, monospace; font-weight: bold; font-size: 14px; }
  .chip { display: inline-block; margin: 1px 3px 1px 0; padding: 2px 7px; border-radius: 10px; cursor: pointer; font-family: Consolas, monospace; font-size: 12px; border: 1px solid transparent; }
  .chip:hover { outline: 2px solid #36c; }
  .chip.c { background: #e8f0fe; color: #174ea6; }
  .chip.b { background: #fef7e0; color: #994d00; }
  .chip.d { background: #e6f4ea; color: #137333; }
  .chip.t { background: #f1f3f4; color: #5f6368; border: 1px dashed #bbb; }
  .src { font-size: 10px; opacity: .75; }
  img.crop { max-width: 220px; cursor: zoom-in; border: 1px solid var(--bd); border-radius: 4px; display: block; }
  input.val { width: 62px; font-family: Consolas, monospace; padding: 3px 5px; border: 1px solid var(--bd); border-radius: 4px; }
  button.act { border: 1px solid var(--bd); background: #fff; border-radius: 4px; padding: 2px 7px; cursor: pointer; margin: 1px 2px; font-size: 12px; }
  button.act:hover { background: #eef; }
  .st { font-weight: bold; }
  .st.done { color: #137333; } .st.lim { color: #994d00; } .st.none { color: var(--mut); }
  .diag { color: #a00; font-size: 11px; }
  #modal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.8); z-index: 50; cursor: zoom-out; }
  #modal img { max-width: 96vw; max-height: 96vh; margin: 2vh auto; display: block; }
  .toolbar { margin: 8px 0; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  select { padding: 3px 6px; }
</style>
</head>
<body>
<header>
  <h1>拼豆色卡校对面板 · card2 v1 <span style="font-size:11px;color:#888">照片模糊卡 · 校对目标 = 色号 + 数量 · 3 个水印遮挡槽需裁决</span></h1>
  <div class="stats" id="stats"></div>
  <div class="toolbar">
    <label>筛选 <select id="filter" onchange="render()"><option value="miss">需处理(漏/存疑/遮挡)</option><option value="all">全部(24)</option><option value="undone">仅未校对</option><option value="cnt">仅数量存疑</option><option value="unk">仅遮挡待裁决</option></select></label>
    <button class="act" style="background:#1a73e8;color:#fff;border-color:#1a73e8;font-weight:bold" onclick="showExport()">📤 导出 / 复制校对结果</button>
    <button class="act" onclick="exportSetCsv()">下载集合汇总 CSV</button>
    <button class="act" onclick="exportAlignCsv()">下载逐槽对齐 CSV</button>
    <button class="act" onclick="resetAll()">清空校对</button>
    <span style="color:#a00;font-size:11px">基准模式：真值列仅用于验收面板，生产版不显示</span>
  </div>
</header>
<main>
  <img id="overview" src="__OVERVIEW__" alt="全卡槽位分布（红=漏项 黄=遮挡待裁决）">
  <table id="tbl"><thead><tr>
    <th>#</th><th>真值(码/量)</th><th>管线输出</th><th>机器建议（点选同时填码+量）</th><th>切片</th><th>校对结果</th><th>操作</th>
  </tr></thead><tbody></tbody></table>
</main>
<div id="modal" onclick="if(event.target===this)closeModal()"><div id="modalBody"></div></div>
<script id="payload" type="application/json">__PAYLOAD__</script>
<script>
const DATA = JSON.parse(document.getElementById('payload').textContent);
const SLOTS = DATA.slots;
const N_KNOWN = DATA.nKnown;
const LS_KEY = 'calib-card2-v1';
const prefillState = {};
for (const s of SLOTS) if (s.prefill) prefillState[s.i] = s.prefill;
let state = Object.assign({}, prefillState, JSON.parse(localStorage.getItem(LS_KEY) || '{}'));

function save() { localStorage.setItem(LS_KEY, JSON.stringify(state)); render(); }
function statusOf(s) { return (state[s.i] && state[s.i].st) || 'none'; }
function parseSug(text) {
  const m = String(text).trim().toUpperCase().match(/^([A-Z]\\d+)\\s+(\\d+)$/);
  if (m) return { code: m[1], count: +m[2] };
  const c = String(text).trim().toUpperCase().match(/^([A-Z]\\d+)$/);
  return c ? { code: c[1], count: null } : null;
}

function render() {
  const filter = document.getElementById('filter').value;
  const tb = document.querySelector('#tbl tbody');
  tb.innerHTML = '';
  let done = 0, doneFull = 0, lim = 0, covered = 0, missN = 0, cntN = 0, unkN = 0, unkDone = 0;
  cntN = SLOTS.filter(s => s.countSuspect).length;
  for (const s of SLOTS) {
    if (filter === 'cnt') { if (!s.countSuspect) continue; }
    else if (filter === 'unk') { if (s.known) continue; }
    else if (filter === 'miss') { if (!s.miss && s.known) continue; }
    if (s.miss) missN++;
    if (!s.known) { unkN++; if (statusOf(s) === 'done' || statusOf(s) === 'lim') unkDone++; }
    const sugAll = [...s.sugC.map(x => ({ ...x, src: 'C' })), ...s.sugB.map(x => ({ ...x, src: 'B' }))];
    if (s.sugD) sugAll.push({ text: s.sugD, src: 'D', score: null, variant: 'AI目读' });
    if (s.known) sugAll.push({ text: s.truth.code + ' ' + s.truth.count, src: 'T', score: null, variant: '基准' });
    if (sugAll.length) covered++;
    const st = statusOf(s);
    if (st === 'done') { done++; if (state[s.i].count != null) doneFull++; }
    if (st === 'lim') lim++;
    if (filter === 'undone' && st !== 'none') continue;
    const tr = document.createElement('tr');
    tr.className = !s.known ? 'unknown' : (s.miss ? 'miss' : (s.countSuspect ? '' : 'ok'));
    const truthHtml = s.known
      ? \`<span class="code">\${s.truth.code}</span> / \${s.truth.count}\`
      : '<span style="color:#b8860b">遮挡待裁决</span><br><span style="font-size:11px;color:#888">' + (s.truth.note || '') + '</span>';
    const sugHtml = sugAll.length
      ? sugAll.map(x => \`<span class="chip \${x.src.toLowerCase()}" onclick="adopt(\${s.i},'\${x.text.replace(/'/g, '')}')" title="\${x.variant || ''} \${x.score != null ? '@' + x.score.toFixed(2) : ''}">\${x.text}<span class="src"> \${x.src}</span></span>\`).join('')
      : '<span style="color:#999">无建议</span>';
    const cropHtml = s.crop ? \`<img class="crop" src="\${s.crop}" onclick="showModal(this.src)">\` : '';
    const sv = state[s.i] || {};
    tr.innerHTML = \`
      <td>\${s.i}</td>
      <td>\${truthHtml}</td>
      <td>\${s.pipe.code ? '<span class="code">' + s.pipe.code + '</span> ' + s.pipe.count : '<span style="color:#999">空</span>'}
          <br><span style="color:#888;font-size:11px">conf \${s.pipe.conf} \${s.pipe.warn}</span>
          \${s.countSuspect ? '<br><span class="diag">⚠数量存疑 ' + s.pipe.count + '≠' + s.truth.count + '</span>' : ''}</td>
      <td>\${sugHtml}</td>
      <td>\${cropHtml}</td>
      <td>
        <input class="val" id="code\${s.i}" value="\${sv.code || ''}" onchange="setVal(\${s.i})" placeholder="色号">
        <input class="val" id="cnt\${s.i}" value="\${sv.count ?? ''}" onchange="setVal(\${s.i})" placeholder="数量" style="width:56px">
        <div class="st \${st === 'none' ? '' : st}" style="margin-top:3px">\${st === 'done' ? '✓已校对' + (sv.count != null ? '' : '(缺数量)') : st === 'lim' ? '⚠读不出' : '未校对'}</div></td>
      <td>
        <button class="act" onclick="mark(\${s.i}, 'lim')">读不出</button>
        <button class="act" onclick="clearRow(\${s.i})">清空</button>
      </td>\`;
    tb.appendChild(tr);
  }
  const truthSet = new Set(SLOTS.filter(s => s.known).map(s => s.truth.code));
  const pipeSet = new Set(SLOTS.map(s => s.pipe.code).filter(Boolean));
  const confirmedCodes = new Set(SLOTS.filter(s => statusOf(s) === 'done' && state[s.i].code).map(s => s_i_code(s.i)));
  function s_i_code(i) { return state[i].code; }
  let setHit = 0, setAfter = 0;
  truthSet.forEach(c => { if (pipeSet.has(c)) setHit++; if (pipeSet.has(c) || confirmedCodes.has(c)) setAfter++; });
  const positional = SLOTS.filter(s => s.known && !s.miss).length;
  document.getElementById('stats').innerHTML =
    \`集合级基线 <b>\${setHit}/\${N_KNOWN}</b> · 位置级 <b>\${positional}/\${N_KNOWN}</b> · 漏项 <b>\${missN}</b> · 遮挡待裁决 <b>\${unkDone}/\${unkN}</b> · 已校对 <b>\${done}</b>(含数量 \${doneFull}) · 读不出 <b>\${lim}</b> · 数量存疑 <b>\${cntN}</b> · 校对后集合级 <b>\${setAfter}/\${N_KNOWN}</b>\`;
}

function readRow(i) {
  return { code: (document.getElementById('code' + i)?.value || '').trim().toUpperCase(),
           count: parseInt(document.getElementById('cnt' + i)?.value, 10) };
}
function setVal(i) {
  const { code, count } = readRow(i);
  state[i] = { code, count: isNaN(count) ? null : count, st: code ? 'done' : 'none' };
  save();
}
function adopt(i, text) {
  const p = parseSug(text);
  if (!p) return;
  state[i] = { code: p.code, count: p.count, st: 'done' };
  save();
}
function mark(i, st) {
  state[i] = state[i] || {};
  state[i].st = state[i].st === st ? 'none' : st;
  if (state[i].st !== 'done') { delete state[i].code; delete state[i].count; }
  save();
}
function clearRow(i) { delete state[i]; save(); }
function resetAll() { if (confirm('清空全部校对记录？')) { state = {}; save(); } }
function showModal(src) {
  document.getElementById('modalBody').innerHTML = '<img src="' + src + '" style="max-width:96vw;max-height:96vh;margin:2vh auto;display:block">';
  document.getElementById('modal').style.display = 'block';
}
function closeModal() { document.getElementById('modal').style.display = 'none'; }

function graded() {
  return SLOTS.map(s => {
    const st = state[s.i] || {};
    const final = st.st === 'lim' ? 'LIM' : (st.code ? { code: st.code, count: st.count ?? null } : null);
    const ok = s.known && final && final !== 'LIM' ? (final.code === s.truth.code && (final.count === null || final.count === s.truth.count)) : false;
    return { i: s.i, truth: s.truth, pipe: s.pipe, final, ok };
  });
}
function showExport() {
  const payload = JSON.stringify({ date: '2026-11-24', card: 'card2', slots: graded() }, null, 1);
  const g = graded();
  const okN = g.filter(x => x.ok).length;
  const doneN = g.filter(x => x.final && x.final !== 'LIM').length;
  const limN = g.filter(x => x.final === 'LIM').length;
  const setHit = (() => { const t = new Set(SLOTS.filter(s => s.known).map(s => s.truth.code)); const o = new Set(SLOTS.map(s => s.pipe.code).filter(Boolean)); let n = 0; t.forEach(c => { if (o.has(c)) n++; }); return n; })();
  const summary = '校对完成 ' + doneN + ' 项（码+量全对 ' + okN + '/' + N_KNOWN + '，读不出 ' + limN + '） | 集合级 = ' + (setHit + doneN) + '/' + N_KNOWN + ' —— 点「一键复制」后粘贴给 AI 入库';
  document.getElementById('modalBody').innerHTML =
    '<div style="background:#fff;max-width:860px;max-height:90vh;margin:3vh auto;padding:18px;border-radius:10px;overflow:auto">' +
    '<h3 style="margin:0 0 8px;font-size:14px">' + summary + '</h3>' +
    '<button class="act" style="background:#1a73e8;color:#fff;font-weight:bold;padding:6px 14px" onclick="copyExport()">📋 一键复制</button>' +
    '<span style="color:#888;font-size:12px;margin-left:8px">复制后粘贴到 AI 对话即可入库</span>' +
    '<textarea id="expTa" readonly style="width:100%;height:52vh;margin-top:10px;font-family:Consolas,monospace;font-size:11px;white-space:pre">' + payload.replace(/</g, '&lt;') + '</textarea></div>';
  document.getElementById('modal').style.display = 'block';
}
function copyExport() {
  const ta = document.getElementById('expTa');
  ta.select();
  const done = () => { ta.style.background = '#e6f4ea'; };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(ta.value).then(done).catch(() => { document.execCommand('copy'); done(); });
  } else {
    document.execCommand('copy'); done();
  }
}
function download(name, text, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name; a.click();
}
function exportSetCsv() {
  const set = new Map();
  for (const g of graded()) {
    if (!g.final || g.final === 'LIM' || !g.ok) continue;
    const prev = set.get(g.final.code);
    if (prev && prev.count != null && g.final.count != null) prev.count += g.final.count;
    else if (!prev) set.set(g.final.code, { count: g.final.count });
  }
  let csv = '色号,数量\\n';
  [...set.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([c, v]) => { csv += c + ',' + (v.count ?? '') + '\\n'; });
  download('card2-集合汇总-校对后.csv', '\\ufeff' + csv, 'text/csv');
}
function exportAlignCsv() {
  let csv = '槽位,真值码,真值数量,管线码,管线数量,校对码,校对数量,与真值一致\\n';
  graded().forEach(g => {
    csv += [g.i, g.truth.code || '遮挡', g.truth.count ?? '', g.pipe.code || '', g.pipe.count ?? '', g.final && g.final !== 'LIM' ? g.final.code : (g.final === 'LIM' ? 'LIM' : ''), g.final && g.final !== 'LIM' ? g.final.count ?? '' : '', g.ok ? '1' : '0'].join(',') + '\\n';
  });
  download('card2-逐槽对齐-校对后.csv', '\\ufeff' + csv, 'text/csv');
}
render();
</script>
</body>
</html>`;

fs.writeFileSync('benchmark/results/calib-panel-card2.html', html.replace('__PAYLOAD__', payload).replace('__OVERVIEW__', overviewJpeg));
console.log('written benchmark/results/calib-panel-card2.html', (html.length / 1024 / 1024).toFixed(1) + 'MB');
