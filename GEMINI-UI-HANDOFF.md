# Gemini UI Optimization Handoff

This file is the handoff contract for the next UI-only optimization pass. Read it before editing the repository.

## Product Context

This is Stellabean, a bead-pattern workspace for converting images into physical fuse-bead grids, drawing and editing bead patterns, viewing a source-image underlay, and exporting patterns. The main audience repeatedly edits patterns on desktop and mobile. Keep the existing product workflows and visual identity recognizable; improve clarity, density, touch ergonomics, and responsive behavior rather than redesigning the product from scratch.

## Current State

- The frontend is a React + TypeScript + Vite application.
- Desktop and mobile workspace shells are separate and share GridCanvas.
- The app has an image studio, settings panel, color palette, statistics, export flows, mobile feature sheet, and draggable source-image reference panel.
- The canvas supports source-image overlay with opacity, fitted to the current bead-grid dimensions and aspect-ratio setting.
- The image conversion pipeline is established and must not be changed during the UI pass.
- Preserve all backend contracts and current Cloudflare bindings/configuration.

## Scope

You may improve only UI presentation, layout, responsive CSS/classes, accessible labels, and UI-only component structure. Keep user-visible behavior and data flow intact.

Likely UI files include:

- src/components/Toolbar.tsx
- src/components/SettingsPanel.tsx
- src/components/GridCanvas.tsx (presentation and controls only)
- src/components/desktop/DesktopWorkspace.tsx
- src/components/mobile/MobileWorkspace.tsx
- src/components/mobile/MobileFeatureSheet.tsx
- src/components/ImageStudioModal.tsx (presentation only)
- Relevant *.test.ts / *.layout.test.ts files for UI contracts

Before editing a component, trace its props through the parent and preserve the existing controlled-state contracts.

## Explicitly Out Of Scope

Do not change or reformat these algorithm/business areas:

- src/utils/imagePipeline.ts
- src/utils/pipelineAuxiliaries.ts
- src/utils/colorUtils.ts
- src/types.ts conversion/business contracts
- Any image quantization, palette matching, edge/outline detection, background-removal, grid sampling, dithering, or post-processing logic
- Any 3D bead/assembly algorithms or workflows
- Worker/backend source, API routes, D1 schema/migrations, production API URLs, Cloudflare bindings, deployment configuration, authentication, credits, payments, or access rules

Do not remove existing controls or workflows to make a layout appear simpler. Do not introduce placeholder buttons or inert controls. Preserve the source-image overlay and opacity behavior, including fit mode and grid dimensions.

## UI Acceptance Criteria

1. Desktop workspace remains efficient and scan-friendly; do not create excessive empty space or oversized hero/card layouts.
2. Mobile canvas retains as much usable canvas area as practical. Controls must not cover critical drawing space unnecessarily.
3. Touch targets remain usable; sliders, toggles, select controls, and buttons must respond correctly and visibly.
4. The source-image reference panel stays compact, has an obvious image icon, and does not interfere with canvas gestures.
5. The source-image overlay stays clipped to the bead board, follows zoom/pan and board dimensions, respects aspect-ratio mode, and remains behind beads/grid details.
6. Text and controls do not overlap or clip at narrow widths, landscape mobile, or browser zoom.
7. Keyboard focus and accessible names are present for icon-only controls.
8. Do not change image-generation results, color counts, palette matching, or conversion settings semantics.

## Required Verification

Run and report:

    node node_modules/typescript/bin/tsc --noEmit
    node node_modules/vitest/vitest.mjs run
    node node_modules/vite/bin/vite.js build
    git diff --check

If browser automation is available, capture desktop and mobile screenshots, including a narrow mobile viewport and landscape viewport. Report exact changed files and any visual checks that could not be performed.

## Handoff Back To Codex

When UI work is ready, put the finished code changes in the shared repository and add GEMINI-UI-RESULT.md containing:

- What changed and why
- Exact files changed
- Tests/build commands and results
- Desktop/mobile viewports checked
- Any remaining issues
- Explicit confirmation that algorithm, backend, business rules, and deployment configuration were not changed

Do not commit or deploy as part of the Gemini UI pass. Codex will review the diff, then handle the separate algorithm optimization and final commit/deployment after the user authorizes that next phase.
