---
title: "Iconoplasm - Visual Mnemonics for Molecular Cell Biology"
description: "Browse gene personas — unique color identities assigned to every human protein-coding gene. Search 19,000+ genes by symbol or name."
canonicalUrl: "https://iconoplasm.brinedew.bio/"
date: 2025-12-01
draft: false
folderPage: true
tags:
- content/apps
---

<h1 class="sr-only">Iconoplasm - Visual Mnemonics for Molecular Cell Biology</h1>

<div style="height: 0; overflow: hidden; position: absolute; left: -9999px;" aria-hidden="true" data-nosnippet>
<h2>About Iconoplasm</h2>
<p>Iconoplasm assigns a unique color identity to every human protein-coding gene. These colors serve as visual mnemonics — persistent, recognizable identities that help you keep track of genes across tools and contexts.</p>
<h3>Gene Personas</h3>
<p>Each gene gets a deterministic color derived from its properties. Published genes also get a portrait — a visual representation of the protein's character.</p>
<h3>Browse and Search</h3>
<p>Explore the full catalog of 19,000+ gene personas. Search by gene symbol (like TP53, BRCA1) or by full name. Click any gene to see its color, portrait status, and links to external databases.</p>
</div>

<div id="iconoplasm-root" data-static="/static/iconoplasm">
  <div class="icono-hero">
    <h1>Iconoplasm</h1>
    <p class="tagline">Visual mnemonics for molecular cell biology</p>
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
  <div class="icono-loading" id="icono-loading">Loading gallery...</div>
  <div class="icono-grid" id="icono-grid" data-layout="bricks" aria-busy="true">
    <article class="icono-card icono-card--brick icono-card--skeleton" aria-hidden="true">
      <div class="icono-card-skeleton-media"></div>
      <div class="icono-card-skeleton-body">
        <span class="icono-card-skeleton-kicker"></span>
        <span class="icono-card-skeleton-line icono-card-skeleton-line--title"></span>
        <span class="icono-card-skeleton-line icono-card-skeleton-line--medium"></span>
        <span class="icono-card-skeleton-line icono-card-skeleton-line--short"></span>
        <span class="icono-card-skeleton-line"></span>
      </div>
    </article>
    <article class="icono-card icono-card--brick icono-card--skeleton" aria-hidden="true">
      <div class="icono-card-skeleton-media"></div>
      <div class="icono-card-skeleton-body">
        <span class="icono-card-skeleton-kicker"></span>
        <span class="icono-card-skeleton-line icono-card-skeleton-line--title"></span>
        <span class="icono-card-skeleton-line icono-card-skeleton-line--medium"></span>
        <span class="icono-card-skeleton-line icono-card-skeleton-line--short"></span>
        <span class="icono-card-skeleton-line"></span>
      </div>
    </article>
    <article class="icono-card icono-card--brick icono-card--skeleton" aria-hidden="true">
      <div class="icono-card-skeleton-media"></div>
      <div class="icono-card-skeleton-body">
        <span class="icono-card-skeleton-kicker"></span>
        <span class="icono-card-skeleton-line icono-card-skeleton-line--title"></span>
        <span class="icono-card-skeleton-line icono-card-skeleton-line--medium"></span>
        <span class="icono-card-skeleton-line icono-card-skeleton-line--short"></span>
        <span class="icono-card-skeleton-line"></span>
      </div>
    </article>
    <article class="icono-card icono-card--brick icono-card--skeleton" aria-hidden="true">
      <div class="icono-card-skeleton-media"></div>
      <div class="icono-card-skeleton-body">
        <span class="icono-card-skeleton-kicker"></span>
        <span class="icono-card-skeleton-line icono-card-skeleton-line--title"></span>
        <span class="icono-card-skeleton-line icono-card-skeleton-line--medium"></span>
        <span class="icono-card-skeleton-line icono-card-skeleton-line--short"></span>
        <span class="icono-card-skeleton-line"></span>
      </div>
    </article>
  </div>
  <div class="icono-load-sentinel" id="icono-load-sentinel" aria-hidden="true"></div>
</div>


