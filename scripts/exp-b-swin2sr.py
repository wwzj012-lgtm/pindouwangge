# -*- coding: utf-8 -*-
"""实验 B：Swin2SR x4 超分 → RapidOCR，对比 nearest 放大基线（实验 C 结果）。

流程：miss-slots.json 的原生 bbox → 原生区域 → Swin2SR x4 → 多变体 → RapidOCR。
判定同实验 C：真值码出现在任一变体输出即 hit。
输出：benchmark/results/实验B-超分对照-2026-11-23.md
用法：python scripts/exp-b-swin2sr.py
"""
import json
import re
import sys
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

ROOT = Path(__file__).resolve().parent.parent
BBOX = ROOT / 'benchmark' / 'results' / 'miss-slots.json'
MODEL = ROOT / 'benchmark' / 'models' / 'swin2sr-x4.onnx'
CARD = ROOT / 'benchmark' / 'images' / 'card1.png'
OUT_MD = ROOT / 'benchmark' / 'results' / '实验B-超分对照-2026-11-23.md'
SCALE = 4

# 实验 C（nearest 放大）的结果基线，用于对照
C_BASELINE = {2: False, 21: False, 23: False, 35: False, 36: False,
              38: False, 45: True, 55: False, 57: True, 58: True, 59: False}
# 剩余 8 漏（45/57/58 已在 C 命中，作对照复查）

from rapidocr import RapidOCR  # noqa: E402

ocr = RapidOCR()


def run_ocr(img_bgr):
    res = ocr(img_bgr)
    items = []
    if res is None:
        return items
    txts = getattr(res, 'txts', None)
    if txts is not None:
        scores = getattr(res, 'scores', None) or [None] * len(txts)
        for t, s in zip(txts, scores):
            items.append((t, float(s) if s is not None else None))
        return items
    if isinstance(res, tuple) and len(res) >= 1:
        res = res[0]
    if isinstance(res, list):
        for row in res:
            if isinstance(row, (list, tuple)) and len(row) >= 2:
                t = row[1]
                s = row[2] if len(row) >= 3 else None
                items.append((str(t), float(s) if s is not None else None))
    return items


class Swin2SR:
    """Xenova/swin2SR-classical-sr-x4-64 ONNX 封装。输入 0-1 RGB，H/W 需为窗口(8)倍数。"""

    def __init__(self, model_path):
        self.sess = ort.InferenceSession(str(model_path), providers=['CPUExecutionProvider'])
        self.inp = self.sess.get_inputs()[0].name
        self.out = self.sess.get_outputs()[0].name

    def __call__(self, bgr):
        h, w = bgr.shape[:2]
        ph = (8 - h % 8) % 8
        pw = (8 - w % 8) % 8
        padded = cv2.copyMakeBorder(bgr, 0, ph, 0, pw, cv2.BORDER_REPLICATE)
        rgb = cv2.cvtColor(padded, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        x = rgb.transpose(2, 0, 1)[None]
        y = self.sess.run([self.out], {self.inp: x})[0][0]  # [3, H*4, W*4]
        y = np.clip(y, 0, 1).transpose(1, 2, 0)
        out = (y * 255).round().astype(np.uint8)
        out = cv2.cvtColor(out, cv2.COLOR_RGB2BGR)
        return out[:h * SCALE, :w * SCALE]


def main():
    boxes = json.loads(BBOX.read_text(encoding='utf-8'))
    img = cv2.imread(str(CARD))
    sr = Swin2SR(MODEL)

    lines = [
        '# 实验 B：Swin2SR x4 超分 → RapidOCR（对照 nearest 基线）',
        '',
        '- 对照：实验 C 的 nearest 放大结果（见 实验C-RapidOCR切片验证）',
        '- 流程：漏槽原生区域 → Swin2SR x4（笔画恢复）→ 6 变体 → RapidOCR',
        '',
        '| 槽位 | 真值 | C(nearest) | B(Swin2SR) 读出 | 判定 |',
        '|---|---|---|---|---|',
    ]
    b_hit = c_hit = 0
    n = 0
    for slot_s, box in sorted(boxes.items(), key=lambda kv: int(kv[0])):
        slot = int(slot_s)
        n += 1
        x0, y0, x1, y1 = box['x0'], box['y0'], box['x1'], box['y1']
        region = img[y0:y1 + 1, x0:x1 + 1]
        try:
            up = sr(region)
        except Exception as e:  # noqa: BLE001
            lines.append(f'| #{slot} | ? | {C_BASELINE.get(slot)} | SR 失败: {e} | ❌ |')
            continue
        gray = cv2.cvtColor(up, cv2.COLOR_BGR2GRAY)
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(gray)
        variants = [('sr', up), ('sr-inv', cv2.bitwise_not(up)),
                    ('clahe', cv2.cvtColor(clahe, cv2.COLOR_GRAY2BGR)),
                    ('clahe-inv', cv2.cvtColor(cv2.bitwise_not(clahe), cv2.COLOR_GRAY2BGR)),
                    ('half', cv2.resize(up, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA)),
                    ('half-inv', cv2.bitwise_not(cv2.resize(up, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA)))]
        found = []
        for tag, frame in variants:
            for t, s in run_ocr(frame):
                if t and t.strip():
                    found.append((tag, t.strip(), s))
        # 真值：从实验 C 表里带过来太绕——直接重读 miss-XX 文件名
        # （这里用 C_BASELINE 无法给真值，改为从文件名解析）
        # truth 从 miss-crops 文件名取
        truth = ''
        for f in (ROOT / 'benchmark' / 'results' / 'miss-crops').iterdir():
            m = re.match(rf'miss-{slot:02d}_([A-Za-z0-9]+?)(?:_wide|_fix|_enh)?\.png', f.name)
            if m:
                truth = m.group(1)
                break
        joined = ' '.join(t for _, t, _ in found).upper().replace(' ', '')
        hit = bool(truth) and truth.upper() in joined
        b_hit += 1 if hit else 0
        c_hit += 1 if C_BASELINE.get(slot) else 0
        detail = ' | '.join(
            f'{tag}:{t}@{s:.2f}' if s is not None else f'{tag}:{t}'
            for tag, t, s in found[:6]) or '（无识别结果）'
        lines.append(f'| #{slot} | {truth or "?"} | {"hit" if C_BASELINE.get(slot) else "miss"} '
                     f'| {detail} | {"✅ hit" if hit else "❌ miss"} |')

    lines += [
        '',
        f'**统计：B(Swin2SR) {b_hit}/{n} vs C(nearest) {c_hit}/{n}**（同槽对照）',
        '',
    ]
    OUT_MD.write_text('\n'.join(lines), encoding='utf-8')
    print(f'written: {OUT_MD}')
    print(f'B hit {b_hit}/{n}, C hit {c_hit}/{n}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
