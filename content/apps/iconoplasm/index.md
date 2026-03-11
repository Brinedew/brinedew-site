---
title: "Iconoplasm - Visual Mnemonics for Molecular Cell Biology"
description: "Browse gene personas — unique color identities assigned to every human protein-coding gene. Search 19,000+ genes by symbol or name."
canonicalUrl: "https://iconoplasm.brinedew.bio/"
date: 2025-12-01
draft: false
folderPage: true
cssclasses:
- iconoplasm-page
tags:
- content/apps
---

<div class="sr-only">Iconoplasm - Mnemonics for genes</div>

<div style="height: 0; overflow: hidden; position: absolute; left: -9999px;" aria-hidden="true" data-nosnippet>
<p>About Iconoplasm.</p>
<p>Iconoplasm assigns a unique color identity to every human protein-coding gene. These colors serve as visual mnemonics — persistent, recognizable identities that help you keep track of genes across tools and contexts.</p>
<p>Gene personas.</p>
<p>Each gene gets a deterministic color derived from its properties. Published genes also get a portrait — a visual representation of the protein's character.</p>
<p>Browse and search.</p>
<p>Explore the full catalog of 19,000+ gene personas. Search by gene symbol (like TP53, BRCA1) or by full name. Click any gene to see its color, portrait status, and links to external databases.</p>
</div>

<div id="iconoplasm-root" data-static="/static/iconoplasm">
  <div class="icono-hero">
    <div class="icono-hero-title">Iconoplasm</div>
    <p class="tagline">Mnemonics for genes - <a class="internal" href="/posts/iconoplasm-faq">read FAQ</a></p>
    <span class="stat" id="icono-gene-count">...</span>
  </div>
  <div class="icono-gallery-toolbar">
    <div class="icono-search icono-search--toolbar">
      <div class="icono-search-wrapper">
        <input type="text" id="icono-q" placeholder="Search by gene symbol or name..." autocomplete="off" />
        <div class="icono-search-results" id="icono-results"></div>
      </div>
    </div>
    <div class="icono-gallery-actions">
      <label class="icono-gallery-order" for="icono-order">
        <span>Order by</span>
        <select id="icono-order">
          <option value="votes" selected>Votes</option>
          <option value="popularity">Popularity</option>
          <option value="newest">Newest</option>
          <option value="random">Random</option>
        </select>
      </label>
    </div>
  </div>
  <div class="icono-loading" id="icono-loading" hidden aria-live="polite"></div>
  <div class="icono-grid" id="icono-grid" data-layout="bricks" aria-busy="true">
    <article class="icono-card icono-card--brick icono-card--skeleton" aria-hidden="true">
      <div class="iconoplasm-tooltip-portrait iconoplasm-tooltip-portrait--skeleton">
        <div class="icono-card-skeleton-portrait-wash"></div>
        <div class="iconoplasm-tooltip-portrait-fade"></div>
      </div>
      <div class="iconoplasm-tooltip-body iconoplasm-tooltip-body--skeleton">
        <div class="iconoplasm-tooltip-header iconoplasm-tooltip-header--skeleton">
          <span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--symbol"></span>
          <span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--name"></span>
        </div>
        <div class="iconoplasm-tooltip-meta iconoplasm-tooltip-meta--skeleton">
          <div class="iconoplasm-tooltip-meta-skeleton-row">
            <div class="iconoplasm-tooltip-meta-skeleton-cell">
              <span class="iconoplasm-tooltip-skeleton-line"></span>
            </div>
            <div class="iconoplasm-tooltip-meta-skeleton-cell iconoplasm-tooltip-meta-skeleton-cell--origin">
              <span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--short"></span>
            </div>
          </div>
          <div class="iconoplasm-tooltip-meta-skeleton-row">
            <div class="iconoplasm-tooltip-meta-skeleton-cell">
              <span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--short"></span>
            </div>
            <div class="iconoplasm-tooltip-meta-skeleton-cell iconoplasm-tooltip-meta-skeleton-cell--origin">
              <span class="iconoplasm-tooltip-skeleton-line"></span>
            </div>
          </div>
          <div class="iconoplasm-tooltip-meta-skeleton-row">
            <div class="iconoplasm-tooltip-meta-skeleton-cell">
              <span class="iconoplasm-tooltip-skeleton-line"></span>
            </div>
            <div class="iconoplasm-tooltip-meta-skeleton-cell iconoplasm-tooltip-meta-skeleton-cell--origin">
              <span class="iconoplasm-tooltip-skeleton-line"></span>
            </div>
          </div>
          <div class="iconoplasm-tooltip-meta-skeleton-row">
            <div class="iconoplasm-tooltip-meta-skeleton-cell">
              <span class="iconoplasm-tooltip-skeleton-line"></span>
            </div>
            <div class="iconoplasm-tooltip-meta-skeleton-cell iconoplasm-tooltip-meta-skeleton-cell--origin">
              <span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--short"></span>
            </div>
          </div>
        </div>
      </div>
    </article>
    <article class="icono-card icono-card--brick icono-card--skeleton" aria-hidden="true">
      <div class="iconoplasm-tooltip-portrait iconoplasm-tooltip-portrait--skeleton">
        <div class="icono-card-skeleton-portrait-wash"></div>
        <div class="iconoplasm-tooltip-portrait-fade"></div>
      </div>
      <div class="iconoplasm-tooltip-body iconoplasm-tooltip-body--skeleton">
        <div class="iconoplasm-tooltip-header iconoplasm-tooltip-header--skeleton">
          <span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--symbol"></span>
          <span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--name"></span>
        </div>
        <div class="iconoplasm-tooltip-meta iconoplasm-tooltip-meta--skeleton">
          <div class="iconoplasm-tooltip-meta-skeleton-row">
            <div class="iconoplasm-tooltip-meta-skeleton-cell">
              <span class="iconoplasm-tooltip-skeleton-line"></span>
            </div>
            <div class="iconoplasm-tooltip-meta-skeleton-cell iconoplasm-tooltip-meta-skeleton-cell--origin">
              <span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--short"></span>
            </div>
          </div>
          <div class="iconoplasm-tooltip-meta-skeleton-row">
            <div class="iconoplasm-tooltip-meta-skeleton-cell">
              <span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--short"></span>
            </div>
            <div class="iconoplasm-tooltip-meta-skeleton-cell iconoplasm-tooltip-meta-skeleton-cell--origin">
              <span class="iconoplasm-tooltip-skeleton-line"></span>
            </div>
          </div>
          <div class="iconoplasm-tooltip-meta-skeleton-row">
            <div class="iconoplasm-tooltip-meta-skeleton-cell">
              <span class="iconoplasm-tooltip-skeleton-line"></span>
            </div>
            <div class="iconoplasm-tooltip-meta-skeleton-cell iconoplasm-tooltip-meta-skeleton-cell--origin">
              <span class="iconoplasm-tooltip-skeleton-line"></span>
            </div>
          </div>
          <div class="iconoplasm-tooltip-meta-skeleton-row">
            <div class="iconoplasm-tooltip-meta-skeleton-cell">
              <span class="iconoplasm-tooltip-skeleton-line"></span>
            </div>
            <div class="iconoplasm-tooltip-meta-skeleton-cell iconoplasm-tooltip-meta-skeleton-cell--origin">
              <span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--short"></span>
            </div>
          </div>
        </div>
      </div>
    </article>
    <article class="icono-card icono-card--brick icono-card--skeleton" aria-hidden="true">
      <div class="iconoplasm-tooltip-portrait iconoplasm-tooltip-portrait--skeleton">
        <div class="icono-card-skeleton-portrait-wash"></div>
        <div class="iconoplasm-tooltip-portrait-fade"></div>
      </div>
      <div class="iconoplasm-tooltip-body iconoplasm-tooltip-body--skeleton">
        <div class="iconoplasm-tooltip-header iconoplasm-tooltip-header--skeleton">
          <span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--symbol"></span>
          <span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--name"></span>
        </div>
        <div class="iconoplasm-tooltip-meta iconoplasm-tooltip-meta--skeleton">
          <div class="iconoplasm-tooltip-meta-skeleton-row">
            <div class="iconoplasm-tooltip-meta-skeleton-cell">
              <span class="iconoplasm-tooltip-skeleton-line"></span>
            </div>
            <div class="iconoplasm-tooltip-meta-skeleton-cell iconoplasm-tooltip-meta-skeleton-cell--origin">
              <span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--short"></span>
            </div>
          </div>
          <div class="iconoplasm-tooltip-meta-skeleton-row">
            <div class="iconoplasm-tooltip-meta-skeleton-cell">
              <span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--short"></span>
            </div>
            <div class="iconoplasm-tooltip-meta-skeleton-cell iconoplasm-tooltip-meta-skeleton-cell--origin">
              <span class="iconoplasm-tooltip-skeleton-line"></span>
            </div>
          </div>
          <div class="iconoplasm-tooltip-meta-skeleton-row">
            <div class="iconoplasm-tooltip-meta-skeleton-cell">
              <span class="iconoplasm-tooltip-skeleton-line"></span>
            </div>
            <div class="iconoplasm-tooltip-meta-skeleton-cell iconoplasm-tooltip-meta-skeleton-cell--origin">
              <span class="iconoplasm-tooltip-skeleton-line"></span>
            </div>
          </div>
          <div class="iconoplasm-tooltip-meta-skeleton-row">
            <div class="iconoplasm-tooltip-meta-skeleton-cell">
              <span class="iconoplasm-tooltip-skeleton-line"></span>
            </div>
            <div class="iconoplasm-tooltip-meta-skeleton-cell iconoplasm-tooltip-meta-skeleton-cell--origin">
              <span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--short"></span>
            </div>
          </div>
        </div>
      </div>
    </article>
    <article class="icono-card icono-card--brick icono-card--skeleton" aria-hidden="true">
      <div class="iconoplasm-tooltip-portrait iconoplasm-tooltip-portrait--skeleton">
        <div class="icono-card-skeleton-portrait-wash"></div>
        <div class="iconoplasm-tooltip-portrait-fade"></div>
      </div>
      <div class="iconoplasm-tooltip-body iconoplasm-tooltip-body--skeleton">
        <div class="iconoplasm-tooltip-header iconoplasm-tooltip-header--skeleton">
          <span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--symbol"></span>
          <span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--name"></span>
        </div>
        <div class="iconoplasm-tooltip-meta iconoplasm-tooltip-meta--skeleton">
          <div class="iconoplasm-tooltip-meta-skeleton-row">
            <div class="iconoplasm-tooltip-meta-skeleton-cell">
              <span class="iconoplasm-tooltip-skeleton-line"></span>
            </div>
            <div class="iconoplasm-tooltip-meta-skeleton-cell iconoplasm-tooltip-meta-skeleton-cell--origin">
              <span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--short"></span>
            </div>
          </div>
          <div class="iconoplasm-tooltip-meta-skeleton-row">
            <div class="iconoplasm-tooltip-meta-skeleton-cell">
              <span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--short"></span>
            </div>
            <div class="iconoplasm-tooltip-meta-skeleton-cell iconoplasm-tooltip-meta-skeleton-cell--origin">
              <span class="iconoplasm-tooltip-skeleton-line"></span>
            </div>
          </div>
          <div class="iconoplasm-tooltip-meta-skeleton-row">
            <div class="iconoplasm-tooltip-meta-skeleton-cell">
              <span class="iconoplasm-tooltip-skeleton-line"></span>
            </div>
            <div class="iconoplasm-tooltip-meta-skeleton-cell iconoplasm-tooltip-meta-skeleton-cell--origin">
              <span class="iconoplasm-tooltip-skeleton-line"></span>
            </div>
          </div>
          <div class="iconoplasm-tooltip-meta-skeleton-row">
            <div class="iconoplasm-tooltip-meta-skeleton-cell">
              <span class="iconoplasm-tooltip-skeleton-line"></span>
            </div>
            <div class="iconoplasm-tooltip-meta-skeleton-cell iconoplasm-tooltip-meta-skeleton-cell--origin">
              <span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--short"></span>
            </div>
          </div>
        </div>
      </div>
    </article>
  </div>
  <div class="icono-load-sentinel" id="icono-load-sentinel" aria-hidden="true"></div>
</div>


