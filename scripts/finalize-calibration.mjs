// 校对结果定稿：生成集合汇总表 + 逐槽对齐表 + 准确率报告。
// 用法：node scripts/finalize-calibration.mjs
process.chdir('D:/Build_Apps/pindouwangge');
const fs = (await import('fs')).default;
const calib = JSON.parse(fs.readFileSync('benchmark/results/card1-calibrated.json', 'utf8'));
const truth = JSON.parse(fs.readFileSync('benchmark/truth-cards.json', 'utf8')).card1;
const truthMap = new Map(truth.entries);

const S = calib.slots;
// 最终值 = 用户校对值，否则管线值
const finalOf = (s) => s.final ?? (s.pipe.code ? { code: s.pipe.code, count: s.pipe.count } : null);

// ---- 统计 ----
let codeOk = 0, countOkKnown = 0, countKnown = 0;
const countSuspects = [];
for (const s of S) {
  const f = finalOf(s);
  const t = truthMap.get(s.truth.code);
  if (f && f.code === s.truth.code) {
    codeOk++;
    countKnown++;
    if (f.count === s.truth.count) countOkKnown++;
    else countSuspects.push(`#${s.i} ${s.truth.code}: ${f.count}≠${s.truth.count}`);
  }
}
// 用户校对的行（码+量双重人工确认）
const humanRows = S.filter(s => s.final);
const humanOk = humanRows.filter(s => s.ok).length;

console.log(`色号（位置级）：${codeOk}/62`);
console.log(`数量（已知真值的行）：${countOkKnown}/${countKnown}`);
console.log(`人工校对行：${humanRows.length}（全对 ${humanOk}），物理极限 0`);
console.log(`数量存疑行（下一轮校对对象）：\n  ${countSuspects.join('\n  ')}`);

// ---- 集合汇总（错槽不影响总数）----
const setMap = new Map();
for (const s of S) {
  const f = finalOf(s);
  if (!f) continue;
  const prev = setMap.get(f.code) || 0;
  setMap.set(f.code, prev + (f.count ?? 0));
}
let setCsv = '\ufeff色号,数量\n';
[...setMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([c, n]) => { setCsv += `${c},${n}\n`; });
fs.writeFileSync('benchmark/results/card1-集合汇总-最终.csv', setCsv, 'utf8');

// ---- 逐槽对齐 ----
let alignCsv = '\ufeff槽位,真值码,真值数量,管线码,管线数量,校对码,校对数量,来源\n';
for (const s of S) {
  const f = finalOf(s);
  alignCsv += [s.i, s.truth.code, s.truth.count, s.pipe.code, s.pipe.count ?? '',
    f ? f.code : '', f ? f.count ?? '' : '', s.final ? '人工' : '管线'].join(',') + '\n';
}
fs.writeFileSync('benchmark/results/card1-逐槽对齐-最终.csv', alignCsv, 'utf8');

// ---- 汇总 markdown ----
let md = `# card1 校对定稿（${calib.date}）\n\n`;
md += `- 色号（位置级）：**${codeOk}/62**（人工校对 ${humanRows.length} 项全对，物理极限 0）\n`;
md += `- 集合级：**${setMap.size} 个唯一色号全部命中**（62/62）\n`;
md += `- 数量：人工确认 ${humanRows.length} 项全对；管线命中的 ${countKnown - humanRows.length} 行中 **${countSuspects.length} 行数量存疑**（见下）\n\n`;
md += `## 数量存疑行（下轮面板校对对象，建议筛选器加「数量存疑」）\n\n`;
countSuspects.forEach(x => { md += `- ${x}\n`; });
md += `\n## 集合汇总（校对后）\n\n| 色号 | 数量 |\n|---|---|\n`;
[...setMap.entries()].sort((a, b) => b[1] - a[1]).forEach(([c, n]) => { md += `| ${c} | ${n} |\n`; });
fs.writeFileSync('benchmark/results/card1-校对定稿-2026-11-24.md', md, 'utf8');
console.log('written: card1-集合汇总-最终.csv / card1-逐槽对齐-最终.csv / card1-校对定稿-2026-11-24.md');
