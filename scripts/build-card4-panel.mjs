// 构建 card4 校对面板（自包含 HTML，离线可开）。
// 沿用 card1/card2 已验证结论：双字段校对、真值 chip、构建时预填、
// 导出弹窗+复制、筛选器走真实 onchange、切片 8x lanczos。
// card4 特有：2 行点状图例 27 槽（row1 14 + row2 13），真值已知（用户
// 清单 + H13 修正），管线 22/27；校对重点 = 数量大面积错 + 3 漏槽，
// 校对结果作为锚库训练数据。
// 用法：node scripts/build-card4-panel.mjs → benchmark/results/calib-panel-card4.html
process.chdir('D:/Build_Apps/pindouwangge');
const { createServer } = await import('vite');
const sharp = (await import('sharp')).default;
const fs = (await import('fs')).default;

// ---- 真值（用户清单 2026-11-24 + 同日目检修正 M13→H13）----
const TRUTH = [
  ['C13', 215], ['D1', 318], ['D3', 133], ['D7', 81], ['D9', 203], ['D17', 256], ['D24', 377],
  ['E14', 241], ['E17', 251], ['F17', 53], ['G1', 265], ['G16', 490], ['H1', 953], ['H14', 91],
  ['C29', 79], ['D2', 216], ['D4', 119], ['D8', 203], ['D10', 556], ['D23', 431], ['E2', 496],
  ['E16', 652], ['F16', 217], ['F20', 219], ['G15', 212], ['G17', 195], ['H13', 62],
];

// ---- 管线最新输出（browser-card4-test 口径，无锚）----
const PIPE = JSON.parse(fs.readFileSync('benchmark/results/card4-pipe-latest.json', 'utf8'));

// ---- 槽位几何：row1 x57..1317 (14), row2 x57..1227 (13)，步距 97 ----
const SLOTS = [];
for (let i = 0; i < 14; i += 1) SLOTS.push({ i, gx: 57 + i * 97, y: 8 });
for (let i = 0; i < 13; i += 1) SLOTS.push({ i: 14 + i, gx: 57 + i * 97, y: 52 });

// ---- 切片 8x lanczos ----
const crops = [];
for (const s of SLOTS) {
  const buf = await sharp('benchmark/images/card4-strip.png')
    .extract({ left: s.gx - 36, top: s.y, width: 97, height: 40 })
    .resize(97 * 8, 40 * 8, { kernel: 'lanczos3' }).sharpen({ sigma: 0.8 })
    .jpeg({ quality: 80 }).toBuffer();
  crops.push(`data:image/jpeg;base64,${buf.toString('base64')}`);
  process.stdout.write(`\rslice ${s.i + 1}/27`);
}
process.stdout.write('\n');

// ---- 组装数据 ----
const rows = SLOTS.map((s, i) => {
  const [tCode, tCount] = TRUTH[i];
  const pipe = PIPE[i] ?? {};
  const codeOk = pipe.code === tCode;
  const cntOk = pipe.count === tCount;
  return {
    i, crop: crops[i],
    truth: { code: tCode, count: tCount },
    pipe: { code: pipe.code ?? '', count: pipe.count ?? 0, warn: pipe.warn ?? '' },
    flags: [!codeOk && 'code', !cntOk && 'count'].filter(Boolean),
  };
});

const html = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>card4 校对面板</title>
<style>
*{box-sizing:border-box} body{font:14px/1.5 system-ui;margin:0;background:#f5f5f5;color:#222}
#hd{position:sticky;top:0;background:#fff;border-bottom:1px solid #ddd;padding:10px 16px;z-index:5}
#hd h1{font-size:16px;margin:0 0 6px}
#stats{font-size:13px;color:#555}
#bar{margin-top:8px;display:flex;gap:8px;align-items:center}
select,button{font:13px system-ui;padding:5px 10px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer}
table{width:100%;border-collapse:collapse}
td{padding:8px;border-bottom:1px solid #e5e5e5;vertical-align:middle}
tr.done{background:#f2f8f2}
tr.is-diff td:nth-child(3){background:#fdf3f0}
.chip{display:inline-block;margin:2px;padding:3px 8px;border:1px solid #bbb;border-radius:12px;background:#fff;cursor:pointer;font-size:12px}
.chip:hover{background:#eef}
.truth{font-weight:600;color:#0a6e3c}
.pipebad{color:#b33}
img.crop{width:194px;height:80px;image-rendering:auto;border:1px solid #ddd;border-radius:4px}
input{font:14px system-ui;padding:4px 6px;border:1px solid #bbb;border-radius:5px;width:70px}
.st{font-size:12px;padding:2px 6px;border-radius:4px;display:inline-block}
.st.ok{background:#e2f2e5;color:#0a6e3c}
.st.diff{background:#fde8e4;color:#b33}
.st.warn{background:#faf3df;color:#8a6d1a}
#modal{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;z-index:9}
#modal.on{display:flex}
#mbody{background:#fff;border-radius:10px;padding:18px;max-width:640px;width:92%;max-height:84vh;overflow:auto}
#mout{width:100%;height:220px;font:12px monospace;margin-top:8px}
</style></head><body>
<div id="hd"><h1>card4 校对面板（点状图例 · 锚库训练数据采集）</h1>
<div id="stats"></div>
<div id="bar">
筛选 <select id="filter">
<option value="diff">有差异（校对重点）</option>
<option value="all">全部 27 槽</option>
<option value="code">色号差异</option>
<option value="count">数量差异</option>
</select>
<button id="export">📤 导出 / 复制校对结果</button>
</div></div>
<table><tbody id="tbl"></tbody></table>
<div id="modal"><div id="mbody">
<h3 id="msum"></h3>
<p>复制下面 JSON 发回给 AI 入库（已确认槽才计入）。</p>
<textarea id="mout" readonly></textarea>
<button id="copy">复制</button> <button id="close">关闭</button>
</div></div>
<script>
const ROWS = ${JSON.stringify(rows)};
const state = ROWS.map(r => ({ code: r.truth.code, count: String(r.truth.count), confirmed: false }));
function render() {
  const f = document.getElementById('filter').value;
  const tb = document.getElementById('tbl');
  tb.innerHTML = '';
  ROWS.forEach((r, i) => {
    const s = state[i];
    const show = f === 'all' || (f === 'code' && r.flags.includes('code')) || (f === 'count' && r.flags.includes('count')) || (f === 'diff' && r.flags.length);
    if (!show) return;
    const tr = document.createElement('tr');
    tr.className = (s.confirmed ? 'done ' : '') + (r.flags.length ? 'is-diff' : '');
    tr.innerHTML = \`<td>#\${i}</td>
      <td><img class="crop" src="\${r.crop}"></td>
      <td>真值 <span class="truth">\${r.truth.code} / \${r.truth.count}</span><br>
          管线 <span class="\${r.flags.length ? 'pipebad' : ''}">\${r.pipe.code || '—'} / \${r.pipe.count}</span>
          \${r.pipe.warn ? '<br><span class="st warn">' + r.pipe.warn + '</span>' : ''}</td>
      <td>校对 <input id="code\${i}" value="\${s.code}" maxlength="4" style="width:56px">
          / <input id="cnt\${i}" value="\${s.count}" style="width:70px">
          <br><label style="font-size:12px"><input type="checkbox" id="ck\${i}" \${s.confirmed ? 'checked' : ''} style="width:auto"> 已确认</label></td>\`;
    tb.appendChild(tr);
  });
  bind();
  stats();
}
function bind() {
  ROWS.forEach((r, i) => {
    const c = document.getElementById('code' + i), n = document.getElementById('cnt' + i), k = document.getElementById('ck' + i);
    if (!c) return;
    const upd = () => {
      s_store(i, c.value, n.value, k.checked);
      const ok = c.value === r.truth.code && Number(n.value) === r.truth.count;
      r.flags = [c.value !== r.truth.code && 'code', Number(n.value) !== r.truth.count && 'count'].filter(Boolean);
      stats();
    };
    c.oninput = upd; n.oninput = upd; k.onchange = upd;
  });
}
function s_store(i, code, count, confirmed) { state[i] = { code, count, confirmed }; }
function stats() {
  const done = state.filter(s => s.confirmed).length;
  const diff = ROWS.filter(r => r.flags.length).length;
  document.getElementById('stats').textContent = \`27 槽 · 管线对 \${27 - diff}/27 · 与真值有差异 \${diff} 槽（校对重点）· 已确认 \${done}\`;
}
document.getElementById('filter').onchange = render;
document.getElementById('export').onclick = () => {
  const confirmed = ROWS.map((r, i) => ({ i, truth: r.truth, pipe: r.pipe, final: state[i].confirmed ? { code: state[i].code, count: Number(state[i].count) || 0 } : null }))
    .filter(x => x.final);
  const summary = \`已确认 \${confirmed.length}/27\`;
  document.getElementById('msum').textContent = 'card4 校对结果：' + summary;
  document.getElementById('mout').value = JSON.stringify({ date: '2026-11-24', card: 'card4', slots: confirmed }, null, 1);
  document.getElementById('modal').classList.add('on');
};
document.getElementById('copy').onclick = () => { navigator.clipboard.writeText(document.getElementById('mout').value); document.getElementById('copy').textContent = '已复制'; };
document.getElementById('close').onclick = () => document.getElementById('modal').classList.remove('on');
render();
</script></body></html>`;
fs.writeFileSync('benchmark/results/calib-panel-card4.html', html);
console.log('written calib-panel-card4.html (' + Math.round(html.length / 1024) + 'KB)');
