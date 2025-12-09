---
title: "Monospace Font Block Character Test"
tags:
  - content/apps
date: 2025-12-09
---

# Monospace Font Block Character Test

**✨ UPDATE: Site now uses Monaspace Xenon web font (no fallbacks)**

This site now loads **Monaspace Xenon** as a web font for all code/monospace text. Every device should render the exact same font with consistent `█` character widths, regardless of what fonts are installed locally.

This page tests whether the `█` (FULL BLOCK U+2588) character renders at the same width as regular letters. If the blocks extend further than the letters below them, there's a width mismatch.

Each section shows 10 block characters on one line and 10 regular letters on the next. In a true monospace font with consistent glyph widths, both lines should be exactly the same length.

**Expected result:** All tests below should now show blocks matching letter width on ALL devices (PC, mobile, tablet) because everyone gets the same Monaspace Xenon web font.

**Current font:** `'Monaspace Xenon'` (loaded via @font-face, 287KB woff2 variable font)

---

## Inline code style (same as backticks in text)
`monospace`
`█████████`
`         `

This uses the inline `<code>` element styling, which should match what you see when text is wrapped in backticks like `monospace`.

<pre style="font-family: var(--codeFont); font-size: 16px; letter-spacing: 0; word-spacing: 0; font-kerning: none; -webkit-font-kerning: none; line-height: 1.5; background: var(--lightgray); padding: 1rem; border-radius: 8px; margin-bottom: 1rem; white-space: pre;"><code>MMMMMMMMMM
██████████
          </code></pre>

---

## Site Default: `var(--codeFont)`

Uses the CSS variable from the site theme: `SFMono-Regular, SF Mono, Menlo, monospace`

<div style="font-family: var(--codeFont); font-size: 16px; letter-spacing: 0; word-spacing: 0; font-kerning: none; -webkit-font-kerning: none; line-height: 1.5; background: var(--lightgray); padding: 1rem; border-radius: 8px; margin-bottom: 1rem;">
<div>██████████</div>
<div>MMMMMMMMMM</div>
<div style="margin-top: 0.5rem;">██████████</div>
<div>aaaaaaaaaa</div>
<div style="margin-top: 0.5rem;">██████████</div>
<div>0000000000</div>
</div>

---

## `SFMono-Regular`

Apple's San Francisco Mono (macOS/iOS).

<div style="font-family: SFMono-Regular, monospace; font-size: 16px; letter-spacing: 0; word-spacing: 0; font-kerning: none; -webkit-font-kerning: none; line-height: 1.5; background: var(--lightgray); padding: 1rem; border-radius: 8px; margin-bottom: 1rem;">
<div>██████████</div>
<div>MMMMMMMMMM</div>
<div style="margin-top: 0.5rem;">██████████</div>
<div>aaaaaaaaaa</div>
<div style="margin-top: 0.5rem;">██████████</div>
<div>0000000000</div>
</div>

---

## `SF Mono`

Apple's San Francisco Mono (alternate name).

<div style="font-family: 'SF Mono', monospace; font-size: 16px; letter-spacing: 0; word-spacing: 0; font-kerning: none; -webkit-font-kerning: none; line-height: 1.5; background: var(--lightgray); padding: 1rem; border-radius: 8px; margin-bottom: 1rem;">
<div>██████████</div>
<div>MMMMMMMMMM</div>
<div style="margin-top: 0.5rem;">██████████</div>
<div>aaaaaaaaaa</div>
<div style="margin-top: 0.5rem;">██████████</div>
<div>0000000000</div>
</div>

---

## `Menlo`

macOS default monospace font.

<div style="font-family: Menlo, monospace; font-size: 16px; letter-spacing: 0; word-spacing: 0; font-kerning: none; -webkit-font-kerning: none; line-height: 1.5; background: var(--lightgray); padding: 1rem; border-radius: 8px; margin-bottom: 1rem;">
<div>██████████</div>
<div>MMMMMMMMMM</div>
<div style="margin-top: 0.5rem;">██████████</div>
<div>aaaaaaaaaa</div>
<div style="margin-top: 0.5rem;">██████████</div>
<div>0000000000</div>
</div>

---

## Generic `monospace` keyword

The CSS `monospace` keyword - what it resolves to depends on your device/browser.

<div style="font-family: monospace; font-size: 16px; letter-spacing: 0; word-spacing: 0; font-kerning: none; -webkit-font-kerning: none; line-height: 1.5; background: var(--lightgray); padding: 1rem; border-radius: 8px; margin-bottom: 1rem;">
<div>██████████</div>
<div>MMMMMMMMMM</div>
<div style="margin-top: 0.5rem;">██████████</div>
<div>aaaaaaaaaa</div>
<div style="margin-top: 0.5rem;">██████████</div>
<div>0000000000</div>
</div>

---

## Common fallback fonts (NOT in site chain, but what `monospace` resolves to)

These fonts are not explicitly in the site's font chain, but they're what the generic `monospace` keyword resolves to on different devices.

### `Roboto Mono` (Android default)

<div style="font-family: 'Roboto Mono', monospace; font-size: 16px; letter-spacing: 0; word-spacing: 0; font-kerning: none; -webkit-font-kerning: none; line-height: 1.5; background: var(--lightgray); padding: 1rem; border-radius: 8px; margin-bottom: 1rem;">
<div>██████████</div>
<div>MMMMMMMMMM</div>
<div style="margin-top: 0.5rem;">██████████</div>
<div>aaaaaaaaaa</div>
<div style="margin-top: 0.5rem;">██████████</div>
<div>0000000000</div>
</div>

### `Droid Sans Mono` (older Android)

<div style="font-family: 'Droid Sans Mono', monospace; font-size: 16px; letter-spacing: 0; word-spacing: 0; font-kerning: none; -webkit-font-kerning: none; line-height: 1.5; background: var(--lightgray); padding: 1rem; border-radius: 8px; margin-bottom: 1rem;">
<div>██████████</div>
<div>MMMMMMMMMM</div>
<div style="margin-top: 0.5rem;">██████████</div>
<div>aaaaaaaaaa</div>
<div style="margin-top: 0.5rem;">██████████</div>
<div>0000000000</div>
</div>

### `Consolas` (Windows default)

<div style="font-family: Consolas, monospace; font-size: 16px; letter-spacing: 0; word-spacing: 0; font-kerning: none; -webkit-font-kerning: none; line-height: 1.5; background: var(--lightgray); padding: 1rem; border-radius: 8px; margin-bottom: 1rem;">
<div>██████████</div>
<div>MMMMMMMMMM</div>
<div style="margin-top: 0.5rem;">██████████</div>
<div>aaaaaaaaaa</div>
<div style="margin-top: 0.5rem;">██████████</div>
<div>0000000000</div>
</div>

### `Courier New` (cross-platform fallback)

<div style="font-family: 'Courier New', monospace; font-size: 16px; letter-spacing: 0; word-spacing: 0; font-kerning: none; -webkit-font-kerning: none; line-height: 1.5; background: var(--lightgray); padding: 1rem; border-radius: 8px; margin-bottom: 1rem;">
<div>██████████</div>
<div>MMMMMMMMMM</div>
<div style="margin-top: 0.5rem;">██████████</div>
<div>aaaaaaaaaa</div>
<div style="margin-top: 0.5rem;">██████████</div>
<div>0000000000</div>
</div>

### `Liberation Mono` (Linux common)

<div style="font-family: 'Liberation Mono', monospace; font-size: 16px; letter-spacing: 0; word-spacing: 0; font-kerning: none; -webkit-font-kerning: none; line-height: 1.5; background: var(--lightgray); padding: 1rem; border-radius: 8px; margin-bottom: 1rem;">
<div>██████████</div>
<div>MMMMMMMMMM</div>
<div style="margin-top: 0.5rem;">██████████</div>
<div>aaaaaaaaaa</div>
<div style="margin-top: 0.5rem;">██████████</div>
<div>0000000000</div>
</div>

### `DejaVu Sans Mono` (Linux common)

<div style="font-family: 'DejaVu Sans Mono', monospace; font-size: 16px; letter-spacing: 0; word-spacing: 0; font-kerning: none; -webkit-font-kerning: none; line-height: 1.5; background: var(--lightgray); padding: 1rem; border-radius: 8px; margin-bottom: 1rem;">
<div>██████████</div>
<div>MMMMMMMMMM</div>
<div style="margin-top: 0.5rem;">██████████</div>
<div>aaaaaaaaaa</div>
<div style="margin-top: 0.5rem;">██████████</div>
<div>0000000000</div>
</div>

---

## Word-length comparison

Testing multi-word patterns like the actual game uses:

<div style="font-family: var(--codeFont); font-size: 16px; letter-spacing: 0; word-spacing: 0; font-kerning: none; -webkit-font-kerning: none; line-height: 1.5; background: var(--lightgray); padding: 1rem; border-radius: 8px; margin-bottom: 1rem;">
<div>█████ ████ ████████</div>
<div>Hello from Proteins</div>
<div style="margin-top: 0.5rem;">████████████ ████ ███████</div>
<div>serine/threonine kinase activity</div>
</div>

---

## How to interpret results

- **Lines are the same length**: The `█` character has the same width as letters in this font. ✅
- **Blocks extend further right**: The `█` character is WIDER than letters. This causes the reflow bug on hint reveal. ❌
- **Blocks are shorter**: The `█` character is NARROWER than letters. This would also cause reflow. ❌

If you see width mismatches on your device, please report which font section shows the issue and what device/browser you're using.
