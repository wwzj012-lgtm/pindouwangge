# -*- coding: utf-8 -*-
"""生成校对面板的三源机器建议 JSON（C=多尺度OCR / B=超分+OCR / D=视觉读码）。

- C 源：miss-crops 裁剪图（剥标注）多尺度变体 RapidOCR
- B 源：miss-slots-all.json 原生 bbox → Swin2SR x4 → 变体 RapidOCR
- D 源：实验 D 视觉大模型读码（硬编码，与人工真值零分歧的 15 项）
输出：benchmark/results/calib-suggestions.json
用法：python scripts/gen-calib-suggestions.py
"""
import json
import re
import sys
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

ROOT = Path(__file__).resolve().parent.parent
CROPS = ROOT / 'benchmark' / 'results' / 'miss-crops2'
BBOX = ROOT / 'benchmark' / 'results' / 'miss-slots-all2.json'
MODEL = ROOT / 'benchmark' / 'models' / 'swin2sr-x4.onnx'
CARD = ROOT / 'benchmark' / 'images' / 'card1.png'
OUT = ROOT / 'benchmark' / 'results' / 'calib-suggestions.json'

# 实验 D：视觉大模型读码（v4 修正行定位后 21/21 全部可读）
D_SUGGEST = {0: 'H2', 2: 'H16', 3: 'A18', 13: 'G2', 14: 'A9', 15: 'G5',
             19: 'A12', 20: 'G3', 21: 'F11', 22: 'F10', 23: 'G8', 24: 'G18',
             35: 'E20', 36: 'M13', 38: 'M14', 41: 'D19', 45: 'H9',
             55: 'E8', 57: 'H8', 58: 'H10', 59: 'H11'}

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


def collect(slot, variants):
    """返回 [(text, score, variant)]，按分数降序。"""
    found = []
    for tag, frame in variants:
        for t, s in run_ocr(frame):
            if t and t.strip():
                found.append((t.strip(), s if s is not None else 0.0, tag))
    found.sort(key=lambda x: -x[1])
    return found


def ocr_variants(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(gray)
    vs = [('orig', img), ('inv', cv2.bitwise_not(img))]
    for tag, sc in (('half', 0.5), ('quart', 0.25)):
        small = cv2.resize(img, None, fx=sc, fy=sc, interpolation=cv2.INTER_AREA)
        vs.append((tag, small))
        vs.append((tag + '-inv', cv2.bitwise_not(small)))
    vs.append(('clahe', cv2.cvtColor(clahe, cv2.COLOR_GRAY2BGR)))
    vs.append(('clahe-inv', cv2.cvtColor(cv2.bitwise_not(clahe), cv2.COLOR_GRAY2BGR)))
    return vs


class Swin2SR:
    def __init__(self, model_path):
        self.sess = ort.InferenceSession(str(model_path), providers=['CPUExecutionProvider'])
        self.inp = self.sess.get_inputs()[0].name
        self.out = self.sess.get_outputs()[0].name

    def __call__(self, bgr):
        h, w = bgr.shape[:2]
        ph, pw = (8 - h % 8) % 8, (8 - w % 8) % 8
        padded = cv2.copyMakeBorder(bgr, 0, ph, 0, pw, cv2.BORDER_REPLICATE)
        rgb = cv2.cvtColor(padded, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        y = self.sess.run([self.out], {self.inp: rgb.transpose(2, 0, 1)[None]})[0][0]
        y = np.clip(y, 0, 1).transpose(1, 2, 0)
        out = cv2.cvtColor((y * 255).round().astype(np.uint8), cv2.COLOR_RGB2BGR)
        return out[:h * 4, :w * 4]


def main():
    boxes = json.loads(BBOX.read_text(encoding='utf-8'))
    img = cv2.imread(str(CARD))
    sr = Swin2SR(MODEL)
    out = {}
    for slot_s, box in sorted(boxes['boxes'].items(), key=lambda kv: int(kv[0])):
        slot = int(slot_s)
        entry = {}
        # ---- C 源：miss-crops2 裁剪（v4 token 边界窗，无标注条、无邻居）----
        crop_files = sorted(CROPS.glob(f'slot-{slot:02d}_*.jpg'))
        c_found = []
        for f in crop_files:
            im = cv2.imread(str(f))
            if im is None:
                continue
            for t, s, tag in collect(slot, ocr_variants(im)):
                c_found.append((t, s, tag))
        c_found.sort(key=lambda x: -x[1])
        entry['c'] = [{'text': t, 'score': round(s, 3), 'variant': tag} for t, s, tag in c_found[:8]]

        # ---- B 源：Swin2SR x4 → 变体 ----
        x0, y0, x1, y1 = box['x0'], box['y0'], box['x1'], box['y1']
        region = img[y0:y1 + 1, x0:x1 + 1]
        try:
            up = sr(region)
            b_found = []
            gray = cv2.cvtColor(up, cv2.COLOR_BGR2GRAY)
            clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(gray)
            sr_vars = [('sr', up), ('sr-inv', cv2.bitwise_not(up)),
                       ('sr-clahe', cv2.cvtColor(clahe, cv2.COLOR_GRAY2BGR)),
                       ('sr-half', cv2.resize(up, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA)),
                       ('sr-half-inv', cv2.bitwise_not(cv2.resize(up, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA)))]
            for t, s, tag in collect(slot, sr_vars):
                b_found.append((t, s, tag))
            b_found.sort(key=lambda x: -x[1])
            entry['b'] = [{'text': t, 'score': round(s, 3), 'variant': tag} for t, s, tag in b_found[:8]]
        except Exception as e:  # noqa: BLE001
            entry['b'] = []
            entry['b_error'] = str(e)

        # ---- D 源 ----
        if slot in D_SUGGEST:
            entry['d'] = {'text': D_SUGGEST[slot], 'note': '视觉大模型读码（与人工真值零分歧）'}
        out[slot] = entry
        print(f'slot {slot}: C={len(entry["c"])} B={len(entry.get("b", []))} D={"Y" if "d" in entry else "-"}')

    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'written: {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
