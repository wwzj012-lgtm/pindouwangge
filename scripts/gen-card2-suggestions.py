# -*- coding: utf-8 -*-
"""card2 校对面板的机器建议 JSON（C=多尺度OCR / B=超分+OCR / D=视觉目读）。

- 切片：benchmark/results/card2-crops/slot-XX_rYcZ.jpg（规则网格 8x，无标注条）
- C 源：切片多尺度变体 RapidOCR
- B 源：card2-slots.json bbox → Swin2SR x4 → 变体 RapidOCR
- D 源：AI 目读（row1/row2 全部 + row3 可读槽，与真值零分歧）
输出：benchmark/results/card2-suggestions.json
用法：envs\\default\\Scripts\\python.exe scripts/gen-card2-suggestions.py
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

ROOT = Path(__file__).resolve().parent.parent
CROPS = ROOT / 'benchmark' / 'results' / 'card2-crops'
SLOTS = ROOT / 'benchmark' / 'results' / 'card2-slots.json'
MODEL = ROOT / 'benchmark' / 'models' / 'swin2sr-x4.onnx'
CARD = ROOT / 'benchmark' / 'images' / 'card2.png'
OUT = ROOT / 'benchmark' / 'results' / 'card2-suggestions.json'

# D 源：AI 目读（8x 行长图 + 单槽复核）。#23 红票残留 M14 笔画、数量被水印盖。
D_SUGGEST = {
    0: 'A1 23', 1: 'A17 11', 2: 'B11 9', 3: 'B14 32', 4: 'B25 59', 5: 'B26 12',
    6: 'C10 70', 7: 'C16 56', 8: 'C17 7', 9: 'C19 26', 10: 'C20 21', 11: 'C22 1',
    12: 'C24 9', 13: 'C26 1', 14: 'F6 8', 15: 'H2 106',
    17: 'H5 36', 18: 'H6 136', 19: 'H7 433', 20: 'M1 16', 22: 'H3 2',
    23: 'M14',  # 部分可读：色号 M14（残留笔画），数量被水印遮挡疑似 22
}

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


def collect(variants):
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
    slots = json.loads(SLOTS.read_text(encoding='utf-8'))['slots']
    img = cv2.imread(str(CARD))
    sr = Swin2SR(MODEL)
    out = {}
    for s in slots:
        slot = s['i']
        entry = {}
        # ---- C 源 ----
        crop_files = sorted(CROPS.glob(f'slot-{slot:02d}_r*.jpg'))
        c_found = []
        for f in crop_files:
            im = cv2.imread(str(f))
            if im is None:
                continue
            for t, sc, tag in collect(ocr_variants(im)):
                c_found.append((t, sc, tag))
        c_found.sort(key=lambda x: -x[1])
        entry['c'] = [{'text': t, 'score': round(sc, 3), 'variant': tag} for t, sc, tag in c_found[:10]]

        # ---- B 源：Swin2SR x4 ----
        x0, y0, w, h = s['x0'], s['y0'], s['w'], s['h']
        region = img[y0:y0 + h, x0:x0 + w]
        try:
            up = sr(region)
            b_found = []
            gray = cv2.cvtColor(up, cv2.COLOR_BGR2GRAY)
            clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(gray)
            sr_vars = [('sr', up), ('sr-inv', cv2.bitwise_not(up)),
                       ('sr-clahe', cv2.cvtColor(clahe, cv2.COLOR_GRAY2BGR)),
                       ('sr-half', cv2.resize(up, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA)),
                       ('sr-half-inv', cv2.bitwise_not(cv2.resize(up, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA)))]
            for t, sc, tag in collect(sr_vars):
                b_found.append((t, sc, tag))
            b_found.sort(key=lambda x: -x[1])
            entry['b'] = [{'text': t, 'score': round(sc, 3), 'variant': tag} for t, sc, tag in b_found[:10]]
        except Exception as e:  # noqa: BLE001
            entry['b'] = []
            entry['b_error'] = str(e)

        # ---- D 源 ----
        if slot in D_SUGGEST:
            entry['d'] = {'text': D_SUGGEST[slot], 'note': 'AI 目读（8x 行长图+单槽复核）'}
        out[slot] = entry
        print(f"slot {slot}: C={len(entry['c'])} B={len(entry.get('b', []))} D={'Y' if 'd' in entry else '-'}")

    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'written: {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
