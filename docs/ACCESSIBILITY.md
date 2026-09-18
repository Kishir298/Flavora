# Flavora Accessibility

Automated coverage is broad; manual assistive-technology (AT) testing has not
been done. This file records what is covered automatically and what a human
AT pass must still verify.

## Automated coverage (runs in CI/local)

- `client/e2e/a11y.spec.ts` — per-route baseline on every route (single
  `<main>` landmark, labelled nav, named buttons, labelled controls, no
  duplicate IDs, image alts, valid ARIA refs) plus guarded
  `@axe-core/playwright` critical/serious check (`wcag2a` + `wcag2aa`).
- `client/e2e/keyboard.spec.ts` — keyboard-only flow (skip link → main →
  operate chat).
- `client/src/nav.test.tsx` — every nav item renders `aria-current="page"`
  when active.
- Foundations in code: skip link moves focus (not just scroll),
  `RouteFocus` moves focus into `<main>` on route change for SR/keyboard
  users, `role=log/status/alert` live regions (chat, sync banner, AI status),
  `aria-busy` on the chat log, visible `:focus-visible` rings,
  `prefers-reduced-motion` support, `html lang="en"`.

## Manual AT checklist (not yet done — human pass required)

Full 24-step NVDA + 24-step VoiceOver plans with result tables live in
`docs/accessibility-screen-reader-checklist.md` — status there is
**PENDING HUMAN VALIDATION**. Summary before claiming WCAG AA conformance:

Run with at least VoiceOver (macOS/iOS Safari) + NVDA or JAWS (Windows
Chrome/Firefox) before claiming WCAG AA conformance:

1. Skip link announces and moves focus to main on every route.
2. Chat flow fully operable screen-reader-only: user message announced,
   "Thinking…" loading announced, follow-up question / recommendations
   announced, error + Retry announced.
3. All icon-only buttons have accessible names at 200% zoom + 320px width.
4. No keyboard traps; focus order matches visual order through nav →
   banner → main → quick actions → results.
5. Charts (Dashboard/Insights) convey the same data via text summaries.
6. Dark mode meets 4.5:1 body-text contrast; focus rings visible in both
   themes with `prefers-reduced-motion` enabled.

## Known gaps

- No AT pass has been recorded (see checklist above).
- `color-contrast-enhanced` (AAA 7:1) intentionally excluded from the axe
  gate — muted secondary text targets AA (4.5:1); see `a11y.spec.ts`.
