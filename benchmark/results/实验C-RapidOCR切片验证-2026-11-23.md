# 实验 C：RapidOCR 切片验证（校对建议源）

- 数据：`benchmark/results/miss-crops/` 全部 miss-*.png（剥标注条后 6 变体：orig/inv/half/quart×正反色 + clahe 正反）
- **关键发现：1/4 缩放（quart）是甜点**——8x 放大字符过大超出 det 舒适区，缩小回 ~32-64px 字高后大量命中，且多数带数量（如 `G2 127`）
- 定位：**校对面板辅助建议**，不接管主识别链路（融合路线黑名单 1）
- 判定：`hit` = 该槽位真值码完整出现在任一变体的 OCR 文本中（忽略大小写/空格）

| 槽位 | 真值 | 管线输出 | RapidOCR 读出（变体:文本@分） | 判定 |
|---|---|---|---|---|
| #0 | H2 | - | half:H2 1770@0.95 | half-inv:H2 1770@0.95 | quart:H2 1770@0.93 | quart-inv:H2 1770@0.92 | ✅ hit |
| #2 | H16 | H16 | half:429@1.00 | half-inv:429@1.00 | quart:429@1.00 | quart-inv:429@1.00 | quart:694 49@0.68 | quart-inv:694 49@0.69 | ❌ miss |
| #3 | A18 | G16 | quart:A18 411@1.00 | quart-inv:A18 411@0.99 | ✅ hit |
| #13 | G2 | - | quart:G2 127@0.99 | quart-inv:G2 127@0.98 | ✅ hit |
| #14 | A9 | - | orig:126@1.00 | half:126@1.00 | half-inv:126@1.00 | quart:126@1.00 | quart-inv:126@1.00 | quart:27 A9 126@0.93 | ✅ hit |
| #15 | G5 | M13 | quart:G5 119@0.99 | quart-inv:G5 119@0.99 | ✅ hit |
| #19 | A12 | - | half:44@1.00 | quart:244@0.90 | quart-inv:244@0.95 | clahe:244@0.91 | half-inv:A12 44@0.98 | quart:A12 44@0.98 | ✅ hit |
| #20 | G3 | - | orig:39@1.00 | half:39@1.00 | quart:39@1.00 | quart-inv:39@1.00 | clahe:39@1.00 | quart:4 G3 39@0.89 | ✅ hit |
| #21 | F11 | - | half:38@1.00 | half-inv:38@1.00 | quart:38@1.00 | quart-inv:38@1.00 | quart:86@0.60 | quart-inv:9 F1 38@0.76 | ❌ miss |
| #22 | F10 | - | quart:F10 31@0.93 | quart-inv:F10 31@0.94 | ✅ hit |
| #23 | G8 | - | half-inv:GB 24@0.88 | quart:GB 24@0.93 | quart-inv:GB 24@0.95 | ❌ miss |
| #24 | G18 | - | quart:G18@1.00 | quart:23@1.00 | quart-inv:G18 2@0.95 | quart-inv:23@1.00 | ✅ hit |
| #35 | E20 | - | orig:1@1.00 | inv:1@1.00 | half-inv:1@1.00 | clahe:1@1.00 | clahe-inv:1@1.00 | quart-inv:1@1.00 | ❌ miss |
| #36 | M13 | - | orig:1@1.00 | inv:1@1.00 | half:1@1.00 | half-inv:1@1.00 | quart:1@1.00 | quart-inv:1@1.00 | ❌ miss |
| #38 | M14 | - | inv:6@1.00 | half:6@1.00 | clahe-inv:6@1.00 | inv:6@0.61 | clahe-inv:6@0.91 | ❌ miss |
| #41 | D19 | - | quart-inv:D19@1.00 | quart-inv:4@1.00 | ✅ hit |
| #45 | H9 | - | half:H9 3@0.91 | quart:H9@1.00 | quart:3@1.00 | quart-inv:H9@1.00 | quart-inv:3@1.00 | ✅ hit |
| #55 | E8 | - | （无识别结果） | ❌ miss |
| #57 | H8 | H8 | quart:H8@1.00 | quart:1@1.00 | quart-inv:H8@1.00 | quart-inv:1@1.00 | ✅ hit |
| #58 | H10 | - | quart:H10@1.00 | quart:1@1.00 | quart-inv:H10@1.00 | quart-inv:1@1.00 | ✅ hit |
| #59 | H11 | - | （无识别结果） | ❌ miss |

**统计：13/21 槽位真值被 RapidOCR 读出**（管线基线 44/62；视觉大模型上限 15/18）
