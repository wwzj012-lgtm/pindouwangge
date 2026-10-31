# Independent conversion evaluation — baseline ready

CURRENT: Turing's attempt reported safely restored; await Mendel target-grid clustering/quantization-order ready (at most two author ablations). One independent ready snapshot and cartoon-focus only: cat100x114 plus actual repo 八条猫58/100 and 小新58/100 (five cartoon cases, synthetic control replaced). No intermediate capture, source-mask repeats, Logo/photo conversion, new materials or full matrix. Cat eyes/collar/clothes original-coordinate ROIs prepared under cartoon-roi/before, no new conversion during preparation. Photo/Logo unchanged output hashes require ready evidence versus the identified safe predecessor; missing evidence is disclosed. Q28/reference frozen. See README.md and DELIVERY.md; historical entries below are superseded operationally.

Baseline source frozen before implementation: HEAD `4af9117e99220c98e8a140e2e4449e8ea2916332`.

- Archive: `artifacts/quality-benchmark/before/head-src.zip`, SHA256 `3e09f40614b5be179fed7292f4892c857f073e1341851f918d972e3d190dac59`.
- Extracted root: `artifacts/quality-benchmark/before/modules/`.
- Original algorithm files had no working-tree differences at capture. Existing App/UI/catalog changes excluded from HEAD archive.
- Implementation worker Franklin `01a17657-3eff-7813-8972-9a8e2d4aa3f3` may proceed; the evaluator executes before from this independent archive.
- Evaluator owns ONLY new `scripts/quality-benchmark/` and ignored `artifacts/quality-benchmark/`; no production utils/App/UI edits, no altered regression assertions, no commit/deploy.

## Entry and scope

App conversion invokes `src/utils/colorUtils.ts:imageToGridWithDiagnostics`, which draws the decoded source into a canvas capped at 1200px on the longest side, then calls `src/utils/imagePipeline.ts:convertImageDataToGrid`. At baseline this is synchronous. `smartReduce.worker.ts` handles manual smart reduction and is not the image conversion entry. The independent browser benchmark will use the same public conversion function, excluding the App's artificial 50ms timeout, API catalogue refresh, UI rendering, file decode, and report generation. All converter preprocessing/sampling/quantization/matching/postprocessing is inside the timer.

Final coverage: exact 58x58 and 100x100, auto/cartoon/photo/logo, frozen Mard-221 palette and user-confirmed Q28/unlimited settings, identical RGBA sources before/after. The preliminary 16-color proposal was superseded by the user's screenshot settings and was not added to the contract. Actual cat100x114 is also covered. Repetitions distinguish fresh-context first calls from same-context warm calls. This is desktop Chrome evidence, not a guarantee for all phones.

## Existing evidence and gaps

- `scripts/image-regression.mjs`: Anya only, 100x56, auto, no timing; cannot certify four modes or natural-photo quality.
- `scripts/algorithm-material-report.mjs`, `docs/algorithm-materials.md`: 48x48, 3 explicit modes, repo art plus synthetic; internal deltaE/transition counts are diagnostic, not a perceptual score.
- `scripts/conversion-quality-report.mjs`: previous HEAD baseline `c0bc93a`, widths 52/104 with preserved aspect, no cold/warm repeats, auto only. Keep separate.
- Inspected repo images: cat/cartoon, Xiaoxin/cartoon, Spider-Man photo-like bust (natural-camera provenance unverified), chibi illustration, Anya illustration. Existing user screenshots are not quality inputs.
- Do not label synthetic smooth gradients as real photographs. Inspect bundled local non-user stock imagery if available; record provenance and limit conclusions accordingly.

Completed: baseline 92 saved cases; final reporting subset fixed at 60 existing cases, no new material expansion. Round1 saved separately in `after`; ready-notified Round2A closure/version in `after-a`, 60 cases completed. Before and A each have SUMMARY.md, compact-summary.json, compact-metrics.csv, index.html and native-scale priority-contact.png. Six independent metric sanity checks passed. See README.md for commands and ROUND2A-HANDOFF.md for specific regressions. B is not captured or run until coordinator ready notice.

Snapshot tests were removed only after absolute-path checks; all production hashes and baseline archive unchanged. Future capture copies nine production closure files only. Beware other workers' whole-directory snapshots: gitignored artifacts are still scanned by tsc.

Latest steering: A's 60 cases are complete; do not expand or run B's full matrix. Await coordinator C-ready and run only three priority user cases with a separate immutable C version. Saved A mode analysis is in `after-a/MODE-ANALYSIS.md`: photo MAE/DeltaE76 closer14/farther1, SSIM closer13/farther2; auto routing unchanged15/15, equal to selected explicit output15/15; every group has distinct cartoon/photo/logo grids. Do not infer all-mode quality from routing. Timing is serial synchronous browser-call wall time, not hardware single-core benchmarking or a phone guarantee.

Superseding update: coordinator reports C not improved and cartoon/logo baseline production outputs restored, only photoA retained. Freeze `final-retained` source closure only, with zero conversions. That capture is not an independent runtime acceptance or a final release. Continue root-cause ablation under coordinator control; future evaluation is three existing priority user cases after a new ready notice. A's 60 results must not be relabeled as final-retained measurements.
