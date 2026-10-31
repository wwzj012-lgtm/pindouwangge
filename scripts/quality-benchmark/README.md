# Independent image-conversion benchmark

No production algorithm, App/UI, tsconfig, existing test thresholds or package configuration is modified. Outputs and any explicitly authorized user originals stay under ignored `artifacts/quality-benchmark/`; tracked reports use relative labels and hashes. No commit, deployment, secrets or external upload.

## Current delivery entry — Mendel cartoon-focus ready only

**Latest scope supersedes earlier priority3/full-matrix plans:** Turing's prior attempt was reported safely restored; wait for Mendel's target-grid clustering/quantization-order ready (author scope at most two ablations). No repeated source-mask investigation, intermediate capture, Logo/photo reconversion or compact60. One ready snapshot, five cartoon cases: primary cat100x114 plus two actual existing repo raster cartoons (八条猫 and 小新), each58/100. No synthetic control in this bounded run. Q28/reference/ROI stay unchanged. Compare photo/Logo ready output-hash evidence against the explicitly identified safe predecessor; if unavailable, disclose the gap, do not assume unchanged.

Fixed cat ROIs have been prepared from original1399x1600 coordinates: eyes535,300,340x115; collar500,425,410x225; clothes450,550,560x500. `cartoon-roi.mjs` records the corresponding enclosing grid cells and fractional original envelopes. The ROI plan is the same for source/before/after, never recentered per candidate. Before contact sheet is `artifacts/quality-benchmark/cartoon-roi/before/roi-contact.png`. Enlarging/cropping display PNGs does not change metric source/reference or generate a new conversion.

```powershell
# PREPARATION ONLY now: render frozen baseline ROI, no converter call.
node scripts/quality-benchmark/cartoon-roi.mjs before
# ONLY after cartoon-ready; use the exact modules root supplied by the coordinator.
node scripts/quality-benchmark/freeze.mjs after-cartoon --source-root READY_SOURCE_MODULE_ROOT
node scripts/quality-benchmark/run.mjs --phase after --tag after-cartoon --scope cartoon-focus
node scripts/quality-benchmark/cartoon-roi.mjs after-cartoon
# STOP for cartoon eye/collar/clothes + control-material review. No Logo/full matrix.
node --test scripts/quality-benchmark/metrics.test.mjs
node --test scripts/quality-benchmark/mode-narrative.test.mjs
```

Cartoon review checks stable source-boundary support and light gray details against dark clothing, with no cross-cell drawing or Q28 reduction. Inspect eyes, collar and jacket seams; contrast recovered supported details against speckles/halos and altered flat blocks. Report small gains plainly and disclose finite-grid limits. Existing photoA grid/hash and independently recorded transparent58 proof should be reused with their version/provenance; do not turn old evidence into a claim that an unmeasured cartoon candidate was reconverted. No four-mode universal improvement claim.

Source-only handoff inventory, output map and privacy boundary: **[DELIVERY.md](DELIVERY.md)**. Preparing these files for a possible future commit is not permission to commit them. No git add/commit/deploy is performed here.

## Frozen contract and timing

`contract.json` fixes originals (byte-for-byte copies), source file hashes, Mard-221 palette/hash, settings and case IDs. Primary settings are Q28, unlimited colors, clarity ON, background OFF, outline OFF, dither NONE (inactive Floyd strength0.65), neutral brightness/contrast/saturation. Clarity ON is fixed at sharpening40: screenshot exposed only a checkbox; 40 is the SettingsPanel toggle-ON action, while initial sharpening30 is also ON. This explicit assumption is identical before/after.

Execute the real synchronous `colorUtils.imageToGridWithDiagnostics(HTMLImageElement, settings, palette)` through Chrome/Vite. The production Canvas1200 limit runs inside the timer; originals are not pre-resized by fixture preparation. Includes preprocessing, sampling, quantization, matching, diagnostics and postprocessing. Excludes file decode, module imports, App artificial delay, API refresh and output generation. Fresh-page first call plus two subsequent warm calls; keep every sample, with deterministic output SHA assertions. Browser process/OS caches may already be warm. Desktop host only; no phone-wide guarantee.

Original browser canvas RGBA is the independent reference for exact fractional box-area comparisons on both white and black. Pipeline-processed samples and internal diagnostic meanDeltaE are not fidelity references. Report RGB MAE, independent Lab DeltaE76, local luma SSIM, edge precision/recall/F1, designated synthetic dark-line precision/recall/F1, alpha errors, color count, same-ID 4-connected small components, PNGs and tradeoffs. One-cell-tolerant edges and global SSIM can hide hollow-circle/broken-line topology; inspect PNGs. Few tiny components or colors is not an aesthetic verdict.

No verified camera photo was available in the inspected existing sources. User-cat is pixel-art, user-logo is a raster logo, repo sources include illustrations and a photo-like Spider-Man bust with unverified provenance. Do not claim general natural-photo quality from these or synthetic gradients.

## Commands

Before is already frozen from HEAD `4af9117e99220c98e8a140e2e4449e8ea2916332` in `before/modules`. Do not replace the baseline or its contract with current working-tree code. The original zip/archive hash, source-pixel hashes, saved grids, complete parameters and report JSON remain evidence. Re-running a scope resumes completed cases without remeasuring them.

```powershell
# First initialization only; external originals are copied only to ignored artifacts.
node scripts/quality-benchmark/run.mjs --phase before --scope priority --cat 'EXTERNAL_CAT_PATH' --logo 'EXTERNAL_LOGO_PATH'

# Final scope: exactly 60 cases, seven existing fixtures, four modes, 58/100 square
# plus actual cat100x114. Earlier baseline contains 92 cases; reporting selects 60.
node scripts/quality-benchmark/run.mjs --phase before --scope compact

# Historical measured A candidate — RESUME/READ ONLY, not a request to rerun.
# Keep prior tags/versioned results as evidence; current entry is G-ready above.

# Untimed observational audit: every grid must equal saved timed output hash.
node scripts/quality-benchmark/audit-probe.mjs artifacts/quality-benchmark/after-a

# Summaries render saved measurements without executing conversions.
node scripts/quality-benchmark/write-report.mjs before
node scripts/quality-benchmark/write-report.mjs after-a
node scripts/quality-benchmark/analyze-modes.mjs after-a
node --test scripts/quality-benchmark/metrics.test.mjs
```

## Snapshot hygiene and evidence

New candidates copy only the relative production import closure (including type imports and untracked implementation helpers), currently nine files. Every copied byte is hashed and checked against source after capture. No App/UI/test copy. Gitignored does not imply excluded from TypeScript; tests copied into artifacts previously blocked tsc, so do not copy directories wholesale.

`snapshot.mjs --cleanup-tests` is a narrowly scoped repair for the original before/after module roots: validates absolute roots, disallows symlinks, deletes only `.test.ts`/`.test.tsx` files, asserts every production TypeScript hash unchanged, and records the operation. It does not clean other workers' directories. The frozen before archive and historical reports are unchanged.

Round1 is non-final `after/` with supplementary `probe-version.json`; Round2A is independent `after-a/` with complete closure hash. `ROUND2A-HANDOFF.md` records mixed results and specific Logo/cartoon regressions. `MODE-ANALYSIS.md` / `mode-analysis.json` summarize saved photo exceptions, auto routing, mode differences and a strict timing boundary. One serial synchronous JS conversion is not a pinned/isolate hardware single-core test; no CPU affinity/quota or CPU-time measurement was used.

Historical retained checkpoint: after C did not improve quality, coordinator restored cartoon/logo baseline production output and retained photoA. `final-retained/` is a **snapshot-only** capture of that state: no new conversion, full matrix, all-mode pass or release. `FREEZE.json` records the exact closure hash and clearly separates coordinator-reported retention from independent runtime verification. Keep A's completed 60-case evidence associated only with A's version hash.

The runner accepts `--phase after --tag final-retained --scope priority` for explicitly requested verification against that historical snapshot, but no such run is currently requested. Do not expand fixtures, run B/C/F matrices, repeat unchanged measured versions, or claim all modes improved. Follow the G-ready delivery entry above.

Subsequent D-final-ready notice was evaluated in **three priority cases only**, under `after-d-final`, copied from the exact author-ready snapshot using `freeze.mjs TAG --source-root artifacts/core-quality-round2d-final/modules`. Nine closure hashes equal the author's manifest. Its independent `REVIEW.md` records visible partial Logo line recovery plus glyph-counter/fragment tradeoffs, near-unchanged cartoon, and a photo grid identical to A. Do not conflate initial D, D-final, A or final-retained, or claim the earlier 60-case A evidence was measured on D.

Playwright uses the bundled desktop runtime fallback and local Chrome; `--chrome PATH` can select an existing browser. No network requests beyond local Vite are allowed by the runner.
