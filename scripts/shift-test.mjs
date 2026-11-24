// 快速测试：识别结果相对手动图做行列平移，看一致率是否在零偏移处最大
import { createServer } from 'vite';
import { readFileSync } from 'fs';

const OUT = 'C:/Users/Plout/Desktop/pindouwangge/pattern_compare/import';
const { manual, recCodes } = JSON.parse(readFileSync(`${OUT}/manual_vs_rec.json`, 'utf8'));
const R = manual.length, C = manual[0].length;
const codeOf = c => c;
for (let dr = -2; dr <= 2; dr++) {
  let line = `dr=${dr}: `;
  for (let dc = -2; dc <= 2; dc++) {
    let same = 0, tot = 0;
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const mc = manual[r]?.[c]?.code;
      const rc = recCodes[r + dr]?.[c + dc];
      if (!mc || mc === '?' || !rc) continue;
      tot++;
      if (mc === rc) same++;
    }
    line += `dc=${dc}:${tot ? (100 * same / tot).toFixed(1) : '-'}%  `;
  }
  console.log(line);
}
