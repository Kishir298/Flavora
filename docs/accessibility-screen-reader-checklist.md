# Flavora Screen-Reader Validation Checklist

> **Status: PENDING HUMAN VALIDATION.**
>
> Automated checks (`client/e2e/a11y.spec.ts`, `keyboard.spec.ts`,
> `nav.test.tsx`) are evidence, NOT a substitute for human screen-reader use.
> Do NOT mark VoiceOver PASS or NVDA PASS until a human completes the matching
> section below and records the result. Automated suites cannot hear
> announcement order, verbosity, or focus confusion — only a human can.

Setup (both environments): `npm run setup`, `npm run start`, open the
website URL it prints. Use a fresh profile where noted.

## A. NVDA — PENDING HUMAN VALIDATION

Environment: Windows 10/11 · Chrome (latest) or Firefox (latest) · NVDA
(latest).

| # | Workflow | Element | Expected behavior | Observed | Severity | Fix required |
|---|----------|---------|-------------------|----------|----------|--------------|
| 1 | Launch Flavora | page | Title + `FLAVORA` heading announced | | | |
| 2 | Navigate the navbar | nav links | All 11 destinations announced by name; current page exposed (`aria-current`) | | | |
| 3 | Reach the assistant | main landmark | Skip link / landmark jump lands in assistant | | | |
| 4 | Focus the food input | `Tell Flavora what you want` | Label + placeholder announced | | | |
| 5 | Enter a request | input | Typed text echoed (`I want something spicy with chicken`) | | | |
| 6 | Submit | Ask Flavora button | Activation announced; `Thinking…` loading announced | | | |
| 7 | User message | chat log | Submitted message announced / browseable as user bubble | | | |
| 8 | Assistant response | chat log | Follow-up question announced (not just visually added) | | | |
| 9 | Follow-up questions | chat log | Each question announced as it arrives | | | |
| 10 | Continue conversation | chat | Multi-turn answers + recommendations announced in order | | | |
| 11 | Navigate recipe results | recommendations | Each `Open <title>` link + match reasons announced | | | |
| 12 | Open a recipe | detail page | Title, ingredients, steps, substitutions announced | | | |
| 13 | Save/log a meal | Save / Log buttons | Confirmation (`Saved` / `Logged "…"`) announced | | | |
| 14 | Navigate dashboard | Dashboard | Week summary, goal progress, insights announced (charts via text alternatives) | | | |
| 15 | Navigate pantry | Inventory | Items, quantities, expiry status announced; sort/filter operable | | | |
| 16 | Navigate grocery list | Groceries | Items, check state, restore announced | | | |
| 17 | Navigate meal planning | Meal plan | Day/meal slots, servings controls announced | | | |
| 18 | Validation errors | e.g. Meals empty name | `role=alert` error announced (`Meal name is required.`) | | | |
| 19 | Loading states | chat / lists | `Thinking…` / `Loading…` announced, not silent | | | |
| 20 | Dialogs | — | **N/A — Flavora has no dialogs** (re-verify; if one was added, test open/close + focus trap + focus return) | | | |
| 21 | Navigate backwards | browser Back | Previous page + focus position sensible | | | |
| 22 | Navigate forwards | browser Forward | Next page + focus position sensible | | | |
| 23 | Refresh the page | reload | Conversation persists; focus starts at a sensible place | | | |
| 24 | Focus/navigation overall | all screens | No traps; order matches visual order; focus always visible | | | |

Result: NVDA PASS / NVDA FAIL (date, tester, NVDA + browser versions).

## B. VoiceOver — PENDING HUMAN VALIDATION

Environment: macOS (latest) · Safari (latest) + Chrome (latest) · VoiceOver.

| # | Workflow | Element | Expected behavior | Observed | Severity | Fix required |
|---|----------|---------|-------------------|----------|----------|--------------|
| 1 | Launch Flavora | page | Title + `FLAVORA` heading announced | | | |
| 2 | Navigate the navbar | nav links | All 11 destinations announced; current page exposed | | | |
| 3 | Reach the assistant | main landmark | Rotor landmark jump lands in assistant | | | |
| 4 | Focus the food input | `Tell Flavora what you want` | Label + placeholder announced | | | |
| 5 | Enter a request | input | Typed text echoed | | | |
| 6 | Submit | Ask Flavora button | Activation + `Thinking…` announced | | | |
| 7 | User message | chat log | User bubble announced / rotor-navigable | | | |
| 8 | Assistant response | chat log | Response announced via live region | | | |
| 9 | Follow-up questions | chat log | Each question announced as it arrives | | | |
| 10 | Continue conversation | chat | Multi-turn flow announced in order | | | |
| 11 | Navigate recipe results | recommendations | `Open <title>` links + reasons announced | | | |
| 12 | Open a recipe | detail page | Title, ingredients, steps, substitutions announced | | | |
| 13 | Save/log a meal | Save / Log buttons | Confirmation announced | | | |
| 14 | Navigate dashboard | Dashboard | Summary, goals, insights announced (charts via text alternatives) | | | |
| 15 | Navigate pantry | Inventory | Items, quantities, expiry announced; sort/filter operable | | | |
| 16 | Navigate grocery list | Groceries | Items, check state, restore announced | | | |
| 17 | Navigate meal planning | Meal plan | Slots + servings controls announced | | | |
| 18 | Validation errors | e.g. Meals empty name | Alert announced | | | |
| 19 | Loading states | chat / lists | Loading announced, not silent | | | |
| 20 | Dialogs | — | **N/A — Flavora has no dialogs** (re-verify; if one was added, test open/close + focus return) | | | |
| 21 | Navigate backwards | swipe/gesture | Previous page sensible | | | |
| 22 | Navigate forwards | swipe/gesture | Next page sensible | | | |
| 23 | Refresh the page | reload | Conversation persists; sensible start point | | | |
| 24 | Focus/navigation overall | all screens | No traps; rotor order sane; focus visible | | | |

Result: VoiceOver PASS / VoiceOver FAIL (date, tester, macOS + browser versions).

## Failure record template

Repeat per failure: screen · workflow step # · element · expected · observed ·
severity (blocker/major/minor) · fix required (code change or wontfix + reason).
