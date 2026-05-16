---
title: "When the winners make the world worse"
date: 2026-05-16
draft: true
tags: [content/apps, topic/fitness-inversion, topic/clonal-governance]
noindex: true
---

<div class="lemons-toy" data-lemons-toy>
  <style>
    .lemons-toy {
      --lemons-bg: color-mix(in srgb, var(--light) 92%, var(--dark) 8%);
      --lemons-panel: color-mix(in srgb, var(--light) 86%, var(--dark) 14%);
      --lemons-line: color-mix(in srgb, var(--gray) 72%, transparent);
      --lemons-muted: var(--darkgray);
      --lemons-text: var(--dark);
      --lemons-accent: var(--secondary);
      --lemons-good: #6aaee8;
      --lemons-quality: #d2a938;
      --lemons-advantage: #d76d5d;
      display: block;
      margin: 1.8rem 0 2.6rem;
      padding: clamp(1rem, 2vw, 1.6rem);
      border: 1px solid var(--lemons-line);
      border-radius: 22px;
      background: linear-gradient(180deg, color-mix(in srgb, var(--lemons-accent) 7%, transparent), transparent 32%), var(--lemons-bg);
    }

    .lemons-toy * { box-sizing: border-box; }

    .lemons-toy__eyebrow {
      margin: 0 0 0.45rem;
      color: var(--lemons-accent);
      font: 700 0.72rem/1.2 var(--headerFont, system-ui);
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    .lemons-toy h2 {
      margin: 0 0 0.6rem;
      max-width: 15ch;
      color: var(--lemons-text);
      font-size: clamp(2rem, 5vw, 4.2rem);
      line-height: 0.96;
      letter-spacing: -0.045em;
    }

    .lemons-toy__lead {
      max-width: 46rem;
      margin: 0 0 1.25rem;
      color: var(--lemons-muted);
      font-size: clamp(1.02rem, 2vw, 1.2rem);
    }

    .lemons-toy__grid {
      display: grid;
      grid-template-columns: minmax(0, 0.92fr) minmax(330px, 1.08fr);
      gap: 1rem;
      align-items: stretch;
    }

    .lemons-toy__panel,
    .lemons-toy__chartbox {
      border: 1px solid var(--lemons-line);
      border-radius: 18px;
      background: var(--lemons-panel);
      box-shadow: 0 10px 30px color-mix(in srgb, var(--dark) 12%, transparent);
    }

    .lemons-toy__panel { padding: 1rem; }
    .lemons-toy__chartbox { padding: 0.85rem; }

    .lemons-toy__machine {
      margin: 0 0 1rem;
      color: var(--lemons-muted);
    }

    .lemons-toy__controls {
      display: grid;
      gap: 1rem;
      margin: 1rem 0;
    }

    .lemons-toy__control-label {
      display: flex;
      justify-content: space-between;
      gap: 0.8rem;
      margin-bottom: 0.35rem;
      color: var(--lemons-muted);
      font: 700 0.82rem/1.2 var(--headerFont, system-ui);
    }

    .lemons-toy input[type="range"] {
      width: 100%;
      accent-color: var(--lemons-accent);
    }

    .lemons-toy__presets {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin: 0.9rem 0 1rem;
    }

    .lemons-toy button {
      border: 1px solid var(--lemons-line);
      border-radius: 999px;
      padding: 0.5rem 0.72rem;
      background: color-mix(in srgb, var(--lemons-panel) 72%, var(--lemons-accent) 28%);
      color: var(--lemons-text);
      font: 700 0.78rem/1 var(--headerFont, system-ui);
      cursor: pointer;
    }

    .lemons-toy button:hover,
    .lemons-toy button:focus-visible {
      border-color: var(--lemons-accent);
      color: var(--lemons-accent);
    }

    .lemons-toy__metrics {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.55rem;
    }

    .lemons-toy__metric {
      min-height: 5rem;
      padding: 0.72rem;
      border: 1px solid var(--lemons-line);
      border-radius: 14px;
      background: color-mix(in srgb, var(--lemons-panel) 80%, var(--dark) 20%);
    }

    .lemons-toy__metric b {
      display: block;
      margin-bottom: 0.25rem;
      color: var(--lemons-text);
      font: 800 1.35rem/1 var(--headerFont, system-ui);
    }

    .lemons-toy__metric span {
      display: block;
      color: var(--lemons-muted);
      font: 650 0.72rem/1.25 var(--headerFont, system-ui);
    }

    .lemons-toy__legend {
      display: flex;
      flex-wrap: wrap;
      gap: 0.65rem 1rem;
      margin-bottom: 0.75rem;
      color: var(--lemons-muted);
      font: 650 0.8rem/1.2 var(--headerFont, system-ui);
    }

    .lemons-toy__swatch {
      display: inline-block;
      width: 0.7rem;
      height: 0.7rem;
      margin-right: 0.35rem;
      border-radius: 999px;
      vertical-align: -0.08rem;
    }

    .lemons-toy canvas {
      display: block;
      width: 100%;
      height: 320px;
      border: 1px solid var(--lemons-line);
      border-radius: 16px;
      background: color-mix(in srgb, var(--lemons-panel) 70%, var(--dark) 30%);
    }

    .lemons-toy__sentence,
    .lemons-toy__guardrail {
      margin-top: 0.85rem;
      padding: 0.85rem 0.95rem;
      border-radius: 14px;
      background: color-mix(in srgb, var(--lemons-accent) 10%, transparent);
      color: var(--lemons-muted);
    }

    .lemons-toy__sentence strong,
    .lemons-toy__guardrail strong { color: var(--lemons-text); }

    .lemons-toy__door {
      max-width: 52rem;
      margin: 1.4rem 0 0;
      padding-left: 1rem;
      border-left: 3px solid var(--lemons-accent);
      color: var(--lemons-muted);
      font-size: 1.04rem;
    }

    @media (max-width: 820px) {
      .lemons-toy__grid { grid-template-columns: 1fr; }
      .lemons-toy__metrics { grid-template-columns: 1fr; }
      .lemons-toy canvas { height: 260px; }
    }
  </style>

  <p class="lemons-toy__eyebrow">tiny market toy</p>
  <h2>When the winners make the world worse</h2>
  <p class="lemons-toy__lead">Drag the visibility slider and watch good sellers vanish — no villain needed.</p>

  <div class="lemons-toy__grid">
    <section class="lemons-toy__panel" aria-label="Toy controls">
      <p class="lemons-toy__machine">Buyers pay for what they can see. Sellers keep selling when the payoff works for them.</p>

      <div class="lemons-toy__controls">
        <div>
          <label class="lemons-toy__control-label" for="lemonsVisibility"><span>quality visibility</span><output id="lemonsVisibilityOut">20%</output></label>
          <input id="lemonsVisibility" type="range" min="0" max="100" value="20" />
        </div>
        <div>
          <label class="lemons-toy__control-label" for="lemonsCost"><span>cost of being good</span><output id="lemonsCostOut">0.72</output></label>
          <input id="lemonsCost" type="range" min="55" max="88" value="72" />
        </div>
      </div>

      <div class="lemons-toy__presets">
        <button type="button" data-lemons-preset="transparent">transparent market</button>
        <button type="button" data-lemons-preset="murky">murky market</button>
        <button type="button" data-lemons-preset="knife">knife-edge</button>
      </div>

      <div class="lemons-toy__metrics" aria-live="polite">
        <div class="lemons-toy__metric"><b id="lemonsQualityMetric">—</b><span>average quality after 24 ticks</span></div>
        <div class="lemons-toy__metric"><b id="lemonsGoodMetric">—</b><span>good sellers remaining</span></div>
        <div class="lemons-toy__metric"><b id="lemonsAdvMetric">—</b><span>lemon profit advantage</span></div>
      </div>

      <p class="lemons-toy__guardrail"><strong>No hidden health meter.</strong> Each tick only updates seller payoff; the falling market is something we measure afterward.</p>
    </section>

    <section class="lemons-toy__chartbox" aria-label="Toy chart">
      <div class="lemons-toy__legend">
        <span><i class="lemons-toy__swatch" style="background: var(--lemons-good)"></i>good sellers</span>
        <span><i class="lemons-toy__swatch" style="background: var(--lemons-quality)"></i>average quality</span>
        <span><i class="lemons-toy__swatch" style="background: var(--lemons-advantage)"></i>lemon advantage</span>
      </div>
      <canvas id="lemonsChart" width="760" height="440" aria-label="Chart of good sellers, average quality, and lemon profit advantage over time"></canvas>
      <p class="lemons-toy__sentence" id="lemonsSentence">—</p>
    </section>
  </div>

  <p class="lemons-toy__door">Beyond markets, the same question gets sharper: are the winners making the system better, or just better for themselves?</p>

  <script>
    (() => {
      const root = document.currentScript?.closest("[data-lemons-toy]")
      if (!root) return

      const HIGH_VALUE = 1.0
      const LOW_VALUE = 0.35
      const LOW_COST = 0.20
      const visibility = root.querySelector("#lemonsVisibility")
      const cost = root.querySelector("#lemonsCost")
      const visibilityOut = root.querySelector("#lemonsVisibilityOut")
      const costOut = root.querySelector("#lemonsCostOut")
      const chart = root.querySelector("#lemonsChart")
      const ctx = chart.getContext("2d")
      const css = () => getComputedStyle(root)

      const clamp = (x, low = 0, high = 1) => Math.max(low, Math.min(high, x))

      function simulate() {
        const visible = Number(visibility.value) / 100
        const asymmetry = 1 - visible
        const highCost = Number(cost.value) / 100
        let highFraction = 0.70
        const history = []

        for (let round = 0; round < 24; round++) {
          const averageQuality = highFraction * HIGH_VALUE + (1 - highFraction) * LOW_VALUE
          const highPrice = visible * HIGH_VALUE + asymmetry * averageQuality
          const lowPrice = visible * LOW_VALUE + asymmetry * averageQuality
          const highProfit = highPrice - highCost
          const lowProfit = lowPrice - LOW_COST
          const highFitness = Math.max(0, 1 + highProfit)
          const lowFitness = Math.max(0, 1 + lowProfit)
          history.push({ round, highFraction, averageQuality, advantage: lowProfit - highProfit })
          const weightedHigh = highFraction * highFitness
          const weightedLow = (1 - highFraction) * lowFitness
          highFraction = clamp(weightedHigh / (weightedHigh + weightedLow))
        }

        const finalQuality = highFraction * HIGH_VALUE + (1 - highFraction) * LOW_VALUE
        history.push({ round: 24, highFraction, averageQuality: finalQuality, advantage: history.at(-1).advantage })
        return history
      }

      function drawLine(history, key, color, transform = (x) => x) {
        const width = chart.width
        const height = chart.height
        const pad = 42
        ctx.strokeStyle = color
        ctx.lineWidth = 4
        ctx.beginPath()
        history.forEach((point, index) => {
          const x = pad + (width - pad * 2) * index / (history.length - 1)
          const y = height - pad - (height - pad * 2) * clamp(transform(point[key]))
          if (index === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.stroke()
      }

      function draw() {
        visibilityOut.value = `${visibility.value}%`
        costOut.value = (Number(cost.value) / 100).toFixed(2)
        const history = simulate()
        const width = chart.width
        const height = chart.height
        const pad = 42
        const styles = css()

        ctx.clearRect(0, 0, width, height)
        ctx.fillStyle = styles.getPropertyValue("--lemons-panel") || "#231a16"
        ctx.fillRect(0, 0, width, height)
        ctx.strokeStyle = styles.getPropertyValue("--lemons-line") || "rgba(128,128,128,.35)"
        ctx.lineWidth = 1
        for (let i = 0; i <= 4; i++) {
          const y = pad + (height - pad * 2) * i / 4
          ctx.beginPath()
          ctx.moveTo(pad, y)
          ctx.lineTo(width - pad, y)
          ctx.stroke()
        }

        drawLine(history, "highFraction", styles.getPropertyValue("--lemons-good"))
        drawLine(history, "averageQuality", styles.getPropertyValue("--lemons-quality"))
        drawLine(history, "advantage", styles.getPropertyValue("--lemons-advantage"), (x) => (x + 0.35) / 0.7)

        const last = history.at(-1)
        const previous = history.at(-2)
        root.querySelector("#lemonsQualityMetric").textContent = last.averageQuality.toFixed(2)
        root.querySelector("#lemonsGoodMetric").textContent = `${Math.round(last.highFraction * 100)}%`
        root.querySelector("#lemonsAdvMetric").textContent = previous.advantage.toFixed(2)
        root.querySelector("#lemonsSentence").innerHTML = last.highFraction < 0.2
          ? "<strong>The cheaper bad seller wins.</strong> The market gets worse one local payoff at a time."
          : "<strong>Good sellers remain viable.</strong> Buyers can see enough quality to keep paying for it."
      }

      visibility.addEventListener("input", draw)
      cost.addEventListener("input", draw)
      root.querySelectorAll("[data-lemons-preset]").forEach((button) => {
        button.addEventListener("click", () => {
          if (button.dataset.lemonsPreset === "transparent") { visibility.value = 100; cost.value = 72 }
          if (button.dataset.lemonsPreset === "murky") { visibility.value = 15; cost.value = 72 }
          if (button.dataset.lemonsPreset === "knife") { visibility.value = 45; cost.value = 78 }
          draw()
        })
      })

      draw()
    })()
  </script>
</div>

%%
Local draft note, 2026-05-16: keep `draft: true` until Vladimir explicitly approves making this visible. This page is seeded from the private lemons prototype and should not be linked from `content/apps/index.md` until approval.
%%
