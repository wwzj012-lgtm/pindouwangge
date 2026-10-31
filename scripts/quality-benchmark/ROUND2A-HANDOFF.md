# Round2A independent review for Franklin — non-final

Please transfer through the coordinating chat; this evaluator has no direct worker-message tool and has not claimed delivery.

Frozen version: `b2220711fe02b51c9eda1bdcf4fdc1739c259fcc2418362fbc9e04d13247e15c`.
Evidence root: `artifacts/quality-benchmark/after-a/`. Original before and first after remain separate.

All measurements below compare output to ORIGINAL browser-decoded RGBA after the unchanged production Canvas1200 path, using independent exact fractional area integration. No pipeline-preprocessed source samples or internal meanDeltaE are used as the fidelity reference. Black and white composites both contribute to MAE/DeltaE76. Same originals, source-pixel hashes, Mard-221, Q28, unlimited colors, clarity ON (fixed sharpening40), no dither/background removal/outlineBoost, default color adjustments.

## Cat cartoon, 100x114: not an accepted quality improvement

| Metric | Before | Round2A | Interpretation |
| --- | ---: | ---: | --- |
| Original-area RGB MAE | 8.5168 | 8.6619 | Worse |
| Original-area DeltaE76 | 3.9751 | 4.0054 | Worse |
| Luma SSIM | 0.86781 | 0.87004 | Small improvement only |
| Edge precision / recall, tolerance1 | 1.00000 / 0.93899 | 0.99950 / 0.93937 | Essentially unchanged |
| Edge F1 | 0.96854 | 0.96850 | No improvement |
| Isolated cells, 4-neighbor | 137 | 151 | +14; not all are noise |
| Cells in components of <=3 | 267 (2.342%) | 344 (3.018%) | +77 cells / +0.675 percentage points |
| Used colors | 17 | 31 | More colors do not establish more faithful structure |

Visual: paper shapes in the background remain largely missing/interrupted; extra pale fragments and tone differences do not restore their original connected outlines. Small details in clothing/face require inspection rather than blanket suppression. Source-stroke audit: 187 proposed cells, no transparent targets, 179 final beads within max-channel RGB35 of the proposal (diagnostic only).

PNG: `artifacts/quality-benchmark/after-a/user-cat-100x114-cartoon-comparison.png` (source/before/after).

## Logo, 100x100: line coverage increased, structure still fails visual review

| Metric | Before | Round2A | Interpretation |
| --- | ---: | ---: | --- |
| Original-area RGB MAE | 4.5754 | 4.6195 | Worse |
| Original-area DeltaE76 | 2.6349 | 2.6848 | Worse |
| Luma SSIM | 0.92015 | 0.92058 | Essentially flat |
| Edge precision / recall, tolerance1 | 0.99382 / 0.98065 | 0.91020 / 0.99777 | Recall gain with substantial precision loss |
| Edge F1 | 0.98719 | 0.95198 | Worse by 0.03522 |
| Isolated cells, 4-neighbor | 74 | 134 | +60 |
| Cells in components of <=3 | 120 (1.20%) | 285 (2.85%) | +165 cells / +1.65 percentage points |
| Used colors | 18 | 19 | Similar palette size |

Visual: some horizontal/vertical lines reappear but remain broken, diagonal dashes compete with the intended grid, and hollow circular beads are still not faithfully represented. The near-flat global SSIM misses this local topology defect. Do not optimize recall alone or merge all small components; circular outlines and intentional dashes can legitimately be small. Source-stroke audit: 359 proposed cells, no transparent targets, 357 within RGB35 of proposal; projection is executing but candidate coverage is not sufficient evidence of clean final connected structure.

PNG: `artifacts/quality-benchmark/after-a/user-logo-100x100-logo-comparison.png`.

## Cat photo accepted as an improvement direction for this image only

Independent original-area MAE 5.1376 -> 3.5429; DeltaE76 2.5305 -> 1.8956; luma SSIM 0.96606 -> 0.97843. Actual effective pipeline is photo, not silently changed to cartoon/logo. Source/palette/settings checks passed. Cat original is pixel-art illustration, not a camera photograph: this does not certify all natural photos.

Three audited output hashes equal the uninstrumented timed grid hashes. Untimed Vite observational wrappers changed no production files. All 9 production closure files are recorded in `probe-version.json`; no test/App/UI files in this candidate snapshot. TypeScript ignores are not relied on: gitignored artifacts can still be included by tsconfig.

Next: keep photo gains and repair source-supported connected pale/color structure in B; evaluator waits for coordinator's B-ready notice before freezing or converting B. Final matrix is fixed at 60 cases (7 existing fixtures, four modes, 58/100 square sizes plus cat100x114), no new material expansion or repeated measurements of completed cases.
