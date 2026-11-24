# -*- coding: utf-8 -*-
"""实验 C：RapidOCR 作为校对建议源，跑 miss-crops 裁剪图。

定位：校对面板的「机器辅助建议」，不接管主识别链路（融合路线黑名单第 1 条）。
预处理：白印码（深票白字）自动补反色变体；每个槽位跑 原图+反色 两个变体取并集。

输出：benchmark/results/实验C-RapidOCR切片验证-2026-11-23.md
用法：python scripts/exp-c-rapidocr.py
"""
import re
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
CROPS = ROOT / 'benchmark' / 'results' / 'miss-crops'
OUT_MD = ROOT / 'benchmark' / 'results' / '实验C-RapidOCR切片验证-2026-11-23.md'

# 管线当前输出（Node 端 2026-11-23 终态，槽位: 输出码，'-'=空）
PIPELINE_OUT = {
    0: '-', 2: 'H16', 3: 'G16', 13: '-', 14: '-', 15: 'M13', 19: '-',
    20: '-', 21: '-', 22: '-', 23: '-', 24: '-', 35: '-', 36: '-',
    38: '-', 41: '-', 45: '-', 55: '-', 57: 'H8', 58: '-', 59: '-',
}

from rapidocr import RapidOCR  # noqa: E402

ocr = RapidOCR()


def run_ocr(img_bgr):
    """兼容 rapidocr 新旧 API：返回 [(text, score), ...]。"""
    res = ocr(img_bgr)
    items = []
    if res is None:
        return items
    # 新 API：RapidOCROutput(.txts/.scores)
    txts = getattr(res, 'txts', None)
    if txts is not None:
        scores = getattr(res, 'scores', None) or [None] * len(txts)
        for t, s in zip(txts, scores):
            items.append((t, float(s) if s is not None else None))
        return items
    # 旧 API：tuple(result, elapse)，result=[[box, text, score], ...]
    if isinstance(res, tuple) and len(res) >= 1:
        res = res[0]
    if isinstance(res, list):
        for row in res:
            if isinstance(row, (list, tuple)) and len(row) >= 2:
                t = row[1]
                s = row[2] if len(row) >= 3 else None
                items.append((str(t), float(s) if s is not None else None))
    return items


def slot_of(name: str):
    """文件名 miss-03_A18.png → (3, 'A18')。"""
    m = re.match(r'miss-(\d+)_([A-Za-z0-9]+?)(?:_wide|_fix|_enh)?\.png', name)
    if not m:
        return None
    return int(m.group(1)), m.group(2)


def main():
    files = sorted(f for f in CROPS.iterdir()
                   if f.suffix == '.png' and f.name.startswith('miss-'))
    if not files:
        print('no crops found', file=sys.stderr)
        return 1

    rows = []  # (slot, truth, [(variant, text, score), ...])
    for f in files:
        parsed = slot_of(f.name)
        if parsed is None:
            continue
        slot, truth = parsed
        img = cv2.imread(str(f))
        if img is None:
            print(f'skip unreadable: {f.name}', file=sys.stderr)
            continue
        # 剥掉顶部标注条（真值写在里面，不剥=作弊泄漏）；enh 版已剥过 40px，再剥 60px 无害
        img = img[60:, :]
        # OCR 检测模型对文字高度敏感（舒适区 ~32-64px）：8x 放大字符过大反而检不出，
        # 补 1/2、1/4 缩放变体 + CLAHE 灰度变体，各槽取并集
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(gray)
        variants = [('orig', img), ('inv', cv2.bitwise_not(img))]
        for tag, sc in (('half', 0.5), ('quart', 0.25)):
            small = cv2.resize(img, None, fx=sc, fy=sc, interpolation=cv2.INTER_AREA)
            variants.append((tag, small))
            variants.append((tag + '-inv', cv2.bitwise_not(small)))
        variants.append(('clahe', cv2.cvtColor(clahe, cv2.COLOR_GRAY2BGR)))
        variants.append(('clahe-inv', cv2.cvtColor(cv2.bitwise_not(clahe), cv2.COLOR_GRAY2BGR)))
        results = []
        for tag, frame in variants:
            for t, s in run_ocr(frame):
                if t and t.strip():
                    results.append((tag, t.strip(), s))
        rows.append((slot, truth, results))

    # 汇总到槽位级
    by_slot = {}
    for slot, truth, results in rows:
        key = (slot, truth)
        by_slot.setdefault(key, []).extend(results)

    lines = [
        '# 实验 C：RapidOCR 切片验证（校对建议源）',
        '',
        '- 数据：`benchmark/results/miss-crops/` 全部 miss-*.png（剥标注条后 6 变体：orig/inv/half/quart×正反色 + clahe 正反）',
        '- **关键发现：1/4 缩放（quart）是甜点**——8x 放大字符过大超出 det 舒适区，缩小回 ~32-64px 字高后大量命中，且多数带数量（如 `G2 127`）',
        '- 定位：**校对面板辅助建议**，不接管主识别链路（融合路线黑名单 1）',
        '- 判定：`hit` = 该槽位真值码完整出现在任一变体的 OCR 文本中（忽略大小写/空格）',
        '',
        '| 槽位 | 真值 | 管线输出 | RapidOCR 读出（变体:文本@分） | 判定 |',
        '|---|---|---|---|---|',
    ]
    n_hit = n_total = 0
    for (slot, truth), results in sorted(by_slot.items()):
        n_total += 1
        joined = ' '.join(t for _, t, _ in results).upper().replace(' ', '')
        hit = truth.upper() in joined
        n_hit += 1 if hit else 0
        detail = ' | '.join(
            f'{tag}:{t}@{s:.2f}' if s is not None else f'{tag}:{t}'
            for tag, t, s in results[:6]
        ) or '（无识别结果）'
        pipe = PIPELINE_OUT.get(slot, '?')
        lines.append(f'| #{slot} | {truth} | {pipe} | {detail} | '
                     f'{"✅ hit" if hit else "❌ miss"} |')

    lines += [
        '',
        f'**统计：{n_hit}/{n_total} 槽位真值被 RapidOCR 读出**'
        '（管线基线 44/62；视觉大模型上限 15/18）',
        '',
    ]
    OUT_MD.write_text('\n'.join(lines), encoding='utf-8')
    print(f'written: {OUT_MD}')
    print(f'hit {n_hit}/{n_total}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
