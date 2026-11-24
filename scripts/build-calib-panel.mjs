// 构建校对面板 v2（自包含 HTML，离线可开）。
// 用法：node scripts/build-calib-panel.mjs → benchmark/results/calib-panel.html
// v2：切片用 miss-crops2（token 边界窗，无邻居）；校对=色号+数量双字段；
// 建议 chip 解析「码 数量」一并填入；导出含数量的物料表。
process.chdir('D:/Build_Apps/pindouwangge');
const { createServer } = await import('vite');
const sharp = (await import('sharp')).default;
const fs = (await import('fs')).default;
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const IL = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');

const { data, info } = await sharp('benchmark/images/card1.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const native = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const r = IL.parseColorCard(native, BRAND_PALETTES.MARD);

const truthCodes = ['H2','G9','H16','A18','F18','G20','G6','E16','F13','G1','A14','F6','F23','G2','A9','G5','G13','H7','F16','A12','G3','F11','F10','G8','G18','E11','F17','H6','F12','G19','E14','F1','E15','H17','G16','E20','M13','H5','M14','A19','A7','D19','C12','F19','H4','H9','H22','C20','C28','D1','D11','D17','G4','C29','E1','E8','F22','H8','H10','H11','H19','M10'];
const truthCounts = [1770,469,429,411,387,271,255,243,197,194,177,141,132,127,126,119,97,54,45,44,39,38,31,24,23,22,22,22,21,14,13,13,12,12,11,9,8,7,6,5,4,4,3,3,3,3,3,2,2,2,2,2,2,1,1,1,1,1,1,1,1,1];

const suggestions = JSON.parse(fs.readFileSync('benchmark/results/calib-suggestions.json', 'utf8'));

// 预填：上一轮已入库的人工校对（localStorage 在预览沙箱里不可靠，改用构建时注入）
let prefill = {};
if (fs.existsSync('benchmark/results/card1-calibrated.json')) {
  const calib = JSON.parse(fs.readFileSync('benchmark/results/card1-calibrated.json', 'utf8'));
  for (const s of calib.slots) {
    if (s.final && s.final !== 'LIM') prefill[s.i] = { code: s.final.code, count: s.final.count ?? null, st: 'done', human: true };
    else if (s.final === 'LIM') prefill[s.i] = { st: 'lim', human: true };
  }
}

const DIAG = {
  0: '碎片/全灭', 2: '碎片(黑票白字)', 3: 'unique毒锚+缺8模板', 13: 'G/D噪声平手0.003',
  14: '碎片/全灭', 15: '毒锚M13+slice切片', 19: '碎片/全灭', 20: '碎片/全灭',
  21: '碎片(票内淡印)', 22: '7片污染', 23: '幻影首片+缺8模板', 24: '缺8模板',
  35: '行定位错误受害者', 36: '行定位错误受害者', 38: '行定位错误受害者', 41: '印刷垃圾级(可读)',
  45: '幻影首片', 55: '行定位错误受害者', 57: '(错槽对照)', 58: '焊桥粘连', 59: '碎片',
};

async function cropJpeg(slot) {
  const p = `benchmark/results/miss-crops2/slot-${String(slot).padStart(2, '0')}_${truthCodes[slot]}.jpg`;
  if (!fs.existsSync(p)) return null;
  const buf = await sharp(p).resize({ width: 1000, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  return 'data:image/jpeg;base64,' + buf.toString('base64');
}

const slots = [];
for (let i = 0; i < 62; i += 1) {
  const e = r.entries[i];
  const isMiss = e.code !== truthCodes[i];
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
    truth: { code: truthCodes[i], count: truthCounts[i] },
    pipe: { code: e.code || '', count: e.count ?? null, conf: e.confidence != null ? +e.confidence.toFixed(2) : null, warn: e.warn || '' },
    miss: isMiss,
    diag: isMiss ? (DIAG[i] || '') : '',
    // 数量存疑：码命中但管线数量与基准不符（基准模式专属标记）
    countSuspect: e.code === truthCodes[i] && e.count !== truthCounts[i],
    sugC: dedupe((sug.c || []).slice(0, 8)).slice(0, 5),
    sugB: dedupe((sug.b || []).slice(0, 8)).slice(0, 5),
    sugD: sug.d ? sug.d.text : null,
    crop: null,
    prefill: prefill[i] || null,
  });
}
for (const s of slots) if (s.miss || s.countSuspect) s.crop = await cropJpeg(s.i);

// 全卡缩略图：行定位用布局铁律 floor(i/19)
const ow = 1100;
const scale = ow / native.width;
const oh = Math.round(native.height * scale);
const rects = slots.filter(s => s.miss).map(s => {
  const band = Math.floor(s.i / 19);
  const tok = s.i % 19;
  const bh = native.height / 4;
  const bx = tok * (native.width / 19), by = band * bh;
  return `<rect x="${Math.round(bx) + 1}" y="${Math.round(by) + 1}" width="${Math.round(native.width / 19) - 2}" height="${Math.round(bh) - 2}" fill="none" stroke="#e33" stroke-width="2"/><text x="${Math.round(bx) + 4}" y="${Math.round(by) + 16}" font-size="13" fill="#e33" font-weight="bold">#${s.i}</text>`;
}).join('');
const overviewJpeg = 'data:image/jpeg;base64,' + (
  await sharp(native.data.buffer, { raw: { width: native.width, height: native.height, channels: 4 } })
    .resize(ow, oh)
    .composite([{ input: Buffer.from(`<svg width="${ow}" height="${oh}">${rects}</svg>`), top: 0, left: 0 }])
    .jpeg({ quality: 80 }).toBuffer()
).toString('base64');

await vite.close();

const payload = JSON.stringify({ slots, overviewJpeg }).replace(/</g, '\\u003c');
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>拼豆色卡校对面板 · card1 · v2</title>
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
  <h1>拼豆色卡校对面板 · card1 v2 <span style="font-size:11px;color:#888">校对目标 = 色号 + 数量（整条确认，物料表需要数量）</span></h1>
  <div class="stats" id="stats"></div>
  <div class="toolbar">
    <label>筛选 <select id="filter" onchange="render()"><option value="miss">仅漏项</option><option value="all">全部(62)</option><option value="undone">仅未校对</option><option value="cnt">仅数量存疑</option></select></label>
    <button class="act" style="background:#1a73e8;color:#fff;border-color:#1a73e8;font-weight:bold" onclick="showExport()">📤 导出 / 复制校对结果</button>
    <button class="act" onclick="exportSetCsv()">下载集合汇总 CSV</button>
    <button class="act" onclick="exportAlignCsv()">下载逐槽对齐 CSV</button>
    <button class="act" onclick="resetAll()">清空校对</button>
    <span style="color:#a00;font-size:11px">基准模式：真值列仅用于验收面板，生产版不显示</span>
  </div>
</header>
<main>
  <img id="overview" src="__OVERVIEW__" alt="全卡漏槽分布">
  <table id="tbl"><thead><tr>
    <th>#</th><th>真值(码/量)</th><th>管线输出</th><th>机器建议（点选同时填码+量）</th><th>切片</th><th>校对结果</th><th>操作</th>
  </tr></thead><tbody></tbody></table>
</main>
<div id="modal" onclick="if(event.target===this)closeModal()"><div id="modalBody"></div></div>
<script id="payload" type="application/json">__PAYLOAD__</script>
<script>
const DATA = JSON.parse(document.getElementById('payload').textContent);
const SLOTS = DATA.slots;
const LS_KEY = 'calib-card1-v2';
// 预填（入库的上一轮校对）为底，localStorage 覆盖其上
const prefillState = {};
for (const s of SLOTS) if (s.prefill) prefillState[s.i] = s.prefill;
let state = Object.assign({}, prefillState, JSON.parse(localStorage.getItem(LS_KEY) || '{}'));

function save() { localStorage.setItem(LS_KEY, JSON.stringify(state)); render(); }
function statusOf(s) { return (state[s.i] && state[s.i].st) || 'none'; }
// 建议 chip 文本解析：「H2 1770」→ {code:'H2', count:1770}；「G2」→ {code:'G2'}
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
  let done = 0, doneFull = 0, lim = 0, covered = 0, missN = 0, cntN = 0;
  cntN = SLOTS.filter(s => s.countSuspect).length; // 全量计数，不受筛选影响
  for (const s of SLOTS) {
    if (filter === 'cnt') {
      if (!s.countSuspect) continue;
    } else if (!s.miss) continue;
    if (s.miss) missN++;
    const sugAll = [...s.sugC.map(x => ({ ...x, src: 'C' })), ...s.sugB.map(x => ({ ...x, src: 'B' }))];
    if (s.sugD) sugAll.push({ text: s.sugD, src: 'D', score: 1 });
    // 基准 chip（仅基准模式）：真值兜底，任何行都可一键采纳
    sugAll.push({ text: s.truth.code + ' ' + s.truth.count, src: 'T', score: null, variant: '基准' });
    if (sugAll.length) covered++;
    const st = statusOf(s);
    if (st === 'done') { done++; if (state[s.i].count != null) doneFull++; }
    if (st === 'lim') lim++;
    if (filter === 'undone' && st !== 'none') continue;
    const tr = document.createElement('tr');
    tr.className = s.miss ? 'miss' : (s.countSuspect ? '' : 'ok');
    const sugHtml = sugAll.length
      ? sugAll.map(x => \`<span class="chip \${x.src.toLowerCase()}" onclick="adopt(\${s.i},'\${x.text.replace(/'/g, '')}')" title="\${x.variant || ''} \${x.score != null ? '@' + x.score.toFixed(2) : ''}">\${x.text}<span class="src"> \${x.src}</span></span>\`).join('')
      : '<span style="color:#999">无建议</span>';
    const cropHtml = s.crop ? \`<img class="crop" src="\${s.crop}" onclick="showModal(this.src)">\` : '';
    const sv = state[s.i] || {};
    tr.innerHTML = \`
      <td>\${s.i}</td>
      <td class="code">\${s.truth.code} / \${s.truth.count}</td>
      <td>\${s.pipe.code ? '<span class="code">' + s.pipe.code + '</span> ' + s.pipe.count : '<span style="color:#999">空</span>'}
          <br><span style="color:#888;font-size:11px">conf \${s.pipe.conf} \${s.pipe.warn}</span>
          \${s.diag ? '<br><span class="diag">' + s.diag + '</span>' : ''}
          \${s.countSuspect ? '<br><span class="diag">⚠数量存疑 ' + s.pipe.count + '≠' + s.truth.count + '</span>' : ''}</td>
      <td>\${sugHtml}</td>
      <td>\${cropHtml}</td>
      <td>
        <input class="val" id="code\${s.i}" value="\${sv.code || ''}" onchange="setVal(\${s.i})" placeholder="色号">
        <input class="val" id="cnt\${s.i}" value="\${sv.count ?? ''}" onchange="setVal(\${s.i})" placeholder="数量" style="width:56px">
        <div class="st \${st === 'none' ? '' : st}" style="margin-top:3px">\${st === 'done' ? '✓已校对' + (sv.count != null ? '' : '(缺数量)') : st === 'lim' ? '⚠物理极限' : '未校对'}</div></td>
      <td>
        <button class="act" onclick="mark(\${s.i}, 'lim')">物理极限</button>
        <button class="act" onclick="clearRow(\${s.i})">清空</button>
      </td>\`;
    tb.appendChild(tr);
  }
  const truthSet = new Set(SLOTS.map(s => s.truth.code));
  const pipeSet = new Set(SLOTS.map(s => s.pipe.code).filter(Boolean));
  // 校对后集合级：真值 ∩ (管线码 ∪ 已确认的人工码)
  const confirmedCodes = new Set(SLOTS.filter(s => statusOf(s) === 'done' && state[s.i].code).map(s => state[s.i].code));
  let setHit = 0, setAfter = 0;
  truthSet.forEach(c => { if (pipeSet.has(c)) setHit++; if (pipeSet.has(c) || confirmedCodes.has(c)) setAfter++; });
  const positional = SLOTS.filter(s => !s.miss).length;
  document.getElementById('stats').innerHTML =
    \`集合级基线 <b>\${setHit}/62</b> · 位置级 <b>\${positional}/62</b> · 漏项 <b>\${missN}</b> · 机器建议覆盖 <b>\${covered}/\${missN}</b> · 已校对 <b>\${done}</b>(含数量 \${doneFull}) · 物理极限 <b>\${lim}</b> · 数量存疑 <b>\${cntN}</b> · 校对后集合级 <b>\${setAfter}/62</b>\`;
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
    const ok = final && final !== 'LIM' ? (final.code === s.truth.code && (final.count === null || final.count === s.truth.count)) : false;
    return { i: s.i, truth: s.truth, pipe: s.pipe, final, ok };
  });
}
function download(name, text, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name; a.click();
}
function exportJson() {
  showExport();
}
// 弹窗导出：预览沙箱会拦 a.click() 下载，改为文本弹窗 + 复制按钮
function showExport() {
  const payload = JSON.stringify({ date: '2026-11-24', card: 'card1', slots: graded() }, null, 1);
  const g = graded();
  const okN = g.filter(x => x.ok).length;
  const doneN = g.filter(x => x.final && x.final !== 'LIM').length;
  const limN = g.filter(x => x.final === 'LIM').length;
  const setHit = (() => { const t = new Set(SLOTS.map(s => s.truth.code)); const o = new Set(SLOTS.map(s => s.pipe.code).filter(Boolean)); let n = 0; t.forEach(c => { if (o.has(c)) n++; }); return n; })();
  const summary = '校对完成 ' + doneN + ' 项（码+量全对 ' + okN + '，物理极限 ' + limN + '） | 集合级 = ' + (setHit + doneN) + '/62 —— 点「一键复制」后粘贴给 AI 入库';
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
function exportSetCsv() {
  // 集合汇总：以校对后为准（错槽不影响总数），数量缺失留空
  const set = new Map();
  for (const g of graded()) {
    if (!g.final || g.final === 'LIM' || !g.ok) continue;
    const prev = set.get(g.final.code);
    if (prev && prev.count != null && g.final.count != null) prev.count += g.final.count;
    else if (!prev) set.set(g.final.code, { count: g.final.count });
  }
  let csv = '色号,数量\\n';
  [...set.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([c, v]) => { csv += c + ',' + (v.count ?? '') + '\\n'; });
  download('card1-集合汇总-校对后.csv', '\\ufeff' + csv, 'text/csv');
}
function exportAlignCsv() {
  let csv = '槽位,真值码,真值数量,管线码,管线数量,校对码,校对数量,与真值一致\\n';
  graded().forEach(g => {
    csv += [g.i, g.truth.code, g.truth.count, g.pipe.code || '', g.pipe.count ?? '', g.final && g.final !== 'LIM' ? g.final.code : (g.final === 'LIM' ? 'LIM' : ''), g.final && g.final !== 'LIM' ? g.final.count ?? '' : '', g.ok ? '1' : '0'].join(',') + '\\n';
  });
  download('card1-逐槽对齐-校对后.csv', '\\ufeff' + csv, 'text/csv');
}
render();
</script>
</body>
</html>`;

fs.writeFileSync('benchmark/results/calib-panel.html', html.replace('__PAYLOAD__', payload).replace('__OVERVIEW__', overviewJpeg));
console.log('written benchmark/results/calib-panel.html', (html.length / 1024 / 1024).toFixed(1) + 'MB');
