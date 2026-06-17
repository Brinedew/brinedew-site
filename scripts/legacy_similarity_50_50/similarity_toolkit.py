#!/usr/bin/env python3
"""
Similarity Toolkit - Gradio GUI for exploring protein similarity metrics.

Tabs:
1. Normalization Explorer - Interactive distribution alignment with live sliders
2. Ladder - Compare structural/functional/blended top-15 for any gene
3. Calibration - Adjust blend weight and see ladder change live
4. Validation - Run test suite
"""
import json
import random
import numpy as np
import torch
from pathlib import Path
import gradio as gr
import plotly.graph_objects as go
from plotly.subplots import make_subplots
from scipy.stats import mode as scipy_mode

# =============================================================================
# Data Loading (cached)
# =============================================================================
print("Loading embeddings...")
esm2_data = torch.load(r"D:\Coding\Datasets\GeneGuessr\cache\ESM2-vectors\ESM2-3B-Human-Gene-Embeddings.pt")
hig2vec_pt = torch.load(r"D:\Coding\Datasets\GeneGuessr\cache\Hig2Vec\hig2vec_human_200dim.pth")

GENE_TO_ESM2 = {g: v.to(torch.float32).numpy() for g, v in esm2_data.items()}
GENE_TO_HIG2VEC = {obj: hig2vec_pt['embeddings'][i].numpy() 
                   for i, obj in enumerate(hig2vec_pt['objects']) 
                   if not obj.startswith('GO:')}

COMMON_GENES = sorted(set(GENE_TO_ESM2.keys()) & set(GENE_TO_HIG2VEC.keys()))
print(f"Loaded {len(COMMON_GENES)} genes with both embeddings")

# Load proteins for UniProt mapping
proteins_file = Path(r"D:\Coding\Datasets\GeneGuessr\output\proteins.json")
with open(proteins_file) as f:
    proteins = json.load(f)
UNIPROT_TO_GENE = {p["uniprot"]: p["gene"] for p in proteins}
GENE_TO_UNIPROT = {p["gene"]: p["uniprot"] for p in proteins}

# =============================================================================
# Normalization Parameters
# =============================================================================
STATS = {
    'esm2': {'scale': 23.0569, 'offset': -21.9954},
    'hig2vec': {'scale': 0.4101, 'offset': 0.5123}
}

def cosine(v1, v2):
    return np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2))

def stage1_transform(cos_val, emb_type):
    s = STATS[emb_type]
    return s['scale'] * cos_val + s['offset']

def stage2_clamp(val):
    return max(0, val)

# =============================================================================
# Tab 1: Interactive Normalization Explorer
# =============================================================================

# Pre-sample cosine similarities for fast interactive updates
print("Precomputing random pair similarities...")
SAMPLE_SIZE = 10000
_sample_pairs = random.sample(list(COMMON_GENES), min(2000, len(COMMON_GENES)))
_esm2_raw_samples = []
_hig2vec_raw_samples = []

_pair_count = 0
while _pair_count < SAMPLE_SIZE:
    g1, g2 = random.sample(_sample_pairs, 2)
    _esm2_raw_samples.append(cosine(GENE_TO_ESM2[g1], GENE_TO_ESM2[g2]))
    _hig2vec_raw_samples.append(cosine(GENE_TO_HIG2VEC[g1], GENE_TO_HIG2VEC[g2]))
    _pair_count += 1

ESM2_RAW = np.array(_esm2_raw_samples)
HIG2VEC_RAW = np.array(_hig2vec_raw_samples)
print(f"Precomputed {SAMPLE_SIZE} similarity pairs for interactive explorer")

def compute_metrics(arr, name):
    """Compute alignment metrics for a distribution."""
    hist, bin_edges = np.histogram(arr, bins=100)
    mode_idx = np.argmax(hist)
    mode_val = (bin_edges[mode_idx] + bin_edges[mode_idx + 1]) / 2
    
    # Right-side percentiles (for aligning right tail)
    p90 = np.percentile(arr, 90)
    p95 = np.percentile(arr, 95)
    p99 = np.percentile(arr, 99)
    
    # Clipping stats (0 to 0.9 range for Stage 2)
    below_zero = np.sum(arr < 0) / len(arr) * 100
    above_90 = np.sum(arr > 0.9) / len(arr) * 100
    
    return {
        'mode': mode_val,
        'median': np.median(arr),
        'p90': p90,
        'p95': p95,
        'p99': p99,
        'below_zero_pct': below_zero,
        'above_90_pct': above_90
    }

def create_interactive_histogram(esm2_scale, esm2_offset, hig2vec_scale, hig2vec_offset):
    """Create 3-row histogram: ESM2 raw/s1, HiG2Vec raw/s1, Blended raw/s1/s2."""
    # Ensure numeric types (Gradio sometimes passes strings)
    esm2_scale = float(esm2_scale)
    esm2_offset = float(esm2_offset)
    hig2vec_scale = float(hig2vec_scale)
    hig2vec_offset = float(hig2vec_offset)
    
    # Stage 1: Transform each embedding
    esm2_s1 = ESM2_RAW * esm2_scale + esm2_offset
    hig2vec_s1 = HIG2VEC_RAW * hig2vec_scale + hig2vec_offset
    
    # Blended (25% structural + 75% functional)
    blended_raw = 0.25 * ESM2_RAW + 0.75 * HIG2VEC_RAW
    blended_s1 = 0.25 * esm2_s1 + 0.75 * hig2vec_s1
    
    # Stage 2: Clamp the BLENDED result to [0, 0.9]
    # Values above 90% are reserved for ladder positions (91-99%)
    blended_s2 = np.clip(blended_s1, 0, 0.9)
    
    # Compute metrics
    esm2_s1_m = compute_metrics(esm2_s1, 'ESM2 S1')
    hig2vec_s1_m = compute_metrics(hig2vec_s1, 'HiG2Vec S1')
    blended_s1_m = compute_metrics(blended_s1, 'Blended S1')
    blended_s2_m = compute_metrics(blended_s2, 'Blended S2')
    
    # Define consistent bin edges for each column
    raw_bins = np.linspace(-0.5, 1.0, 76)   # Raw cosine range
    s1_bins = np.linspace(-0.3, 1.1, 71)    # Stage 1 range
    s2_bins = np.linspace(0, 0.92, 47)      # Stage 2: clamped to [0, 0.9]
    
    # Create figure: 3 rows, 3 cols
    # Row 1: ESM2 (raw, s1, empty)
    # Row 2: HiG2Vec (raw, s1, empty)
    # Row 3: Blended (raw, s1, s2)
    fig = make_subplots(
        rows=3, cols=3,
        subplot_titles=[
            'Raw Cosine', 'Stage 1: Linear Transform', '',
            '', '', '',
            '', '', 'Stage 2: Blend + Clamp'
        ],
        vertical_spacing=0.08,
        horizontal_spacing=0.06
    )
    
    def add_hist(row, col, data, name, color, bins):
        fig.add_trace(
            go.Histogram(x=data, name=name, marker_color=color, opacity=0.7,
                        xbins=dict(start=bins[0], end=bins[-1], size=bins[1]-bins[0])),
            row=row, col=col
        )
    
    # Row 1: ESM2 (raw and s1 only)
    add_hist(1, 1, ESM2_RAW, 'ESM2', 'steelblue', raw_bins)
    add_hist(1, 2, esm2_s1, 'ESM2', 'steelblue', s1_bins)
    
    # Row 2: HiG2Vec (raw and s1 only)
    add_hist(2, 1, HIG2VEC_RAW, 'HiG2Vec', 'forestgreen', raw_bins)
    add_hist(2, 2, hig2vec_s1, 'HiG2Vec', 'forestgreen', s1_bins)
    
    # Row 3: Blended (raw, s1, and s2)
    add_hist(3, 1, blended_raw, 'Blended', 'purple', raw_bins)
    add_hist(3, 2, blended_s1, 'Blended', 'purple', s1_bins)
    add_hist(3, 3, blended_s2, 'Blended', 'purple', s2_bins)
    
    # Add mode lines to Stage 1 column
    fig.add_vline(x=esm2_s1_m['mode'], line_dash='dash', line_color='blue', row=1, col=2)
    fig.add_vline(x=hig2vec_s1_m['mode'], line_dash='dash', line_color='green', row=2, col=2)
    fig.add_vline(x=blended_s1_m['mode'], line_dash='dash', line_color='purple', row=3, col=2)
    
    # Add 0.5 target line to Stage 1 plots
    for row in [1, 2, 3]:
        fig.add_vline(x=0.5, line_dash='dot', line_color='red', row=row, col=2)
    
    # Add mode line to Stage 2 (blended only)
    fig.add_vline(x=blended_s2_m['mode'], line_dash='dash', line_color='purple', row=3, col=3)
    
    fig.update_layout(
        height=750,
        showlegend=True,
        barmode='overlay',
        title_text='Distribution Explorer: Stage 1 aligns modes, Stage 2 clamps blend',
        legend=dict(yanchor="top", y=0.99, xanchor="right", x=0.99)
    )
    
    # Consistent x-axis ranges for each column
    for row in [1, 2, 3]:
        fig.update_xaxes(range=[-0.5, 1.0], row=row, col=1)   # Raw column
        fig.update_xaxes(range=[-0.3, 1.1], row=row, col=2)   # Stage 1 column
    fig.update_xaxes(range=[-0.02, 0.92], row=3, col=3)     # Stage 2: clamped to [0, 0.9]
    
    # Add row labels
    fig.add_annotation(x=-0.06, y=0.83, text="ESM2", textangle=-90, 
                       xref="paper", yref="paper", showarrow=False, font=dict(size=12))
    fig.add_annotation(x=-0.06, y=0.50, text="HiG2Vec", textangle=-90,
                       xref="paper", yref="paper", showarrow=False, font=dict(size=12))
    fig.add_annotation(x=-0.06, y=0.17, text="Blended", textangle=-90,
                       xref="paper", yref="paper", showarrow=False, font=dict(size=12))
    
    return fig

def format_metrics(esm2_scale, esm2_offset, hig2vec_scale, hig2vec_offset):
    """Format alignment metrics as markdown."""
    # Ensure numeric types (Gradio sometimes passes strings)
    esm2_scale = float(esm2_scale)
    esm2_offset = float(esm2_offset)
    hig2vec_scale = float(hig2vec_scale)
    hig2vec_offset = float(hig2vec_offset)
    
    # Stage 1: individual transforms
    esm2_s1 = ESM2_RAW * esm2_scale + esm2_offset
    hig2vec_s1 = HIG2VEC_RAW * hig2vec_scale + hig2vec_offset
    
    # Stage 2: blend first, then clamp to [0, 0.9]
    blended_s1 = 0.25 * esm2_s1 + 0.75 * hig2vec_s1
    blended_s2 = np.clip(blended_s1, 0, 0.9)
    
    esm2_s1_m = compute_metrics(esm2_s1, 'ESM2')
    hig2vec_s1_m = compute_metrics(hig2vec_s1, 'HiG2Vec')
    blended_s1_m = compute_metrics(blended_s1, 'Blended S1')
    blended_s2_m = compute_metrics(blended_s2, 'Blended S2')
    
    mode_diff = abs(esm2_s1_m['mode'] - hig2vec_s1_m['mode'])
    
    lines = [
        "### Alignment Metrics (Stage 1)",
        "",
        "| Metric | ESM2 | HiG2Vec | Target | Diff |",
        "|--------|------|---------|--------|------|",
        f"| Mode | {esm2_s1_m['mode']:.3f} | {hig2vec_s1_m['mode']:.3f} | 0.500 | {mode_diff:.3f} |",
        f"| P90 | {esm2_s1_m['p90']:.3f} | {hig2vec_s1_m['p90']:.3f} | - | {abs(esm2_s1_m['p90'] - hig2vec_s1_m['p90']):.3f} |",
        f"| P99 | {esm2_s1_m['p99']:.3f} | {hig2vec_s1_m['p99']:.3f} | - | {abs(esm2_s1_m['p99'] - hig2vec_s1_m['p99']):.3f} |",
        "",
        "### Blended Output (Stage 2: 25% ESM2 + 75% HiG2Vec, clamped)",
        "",
        "| Metric | Before Clamp | After Clamp |",
        "|--------|--------------|-------------|",
        f"| Mode | {blended_s1_m['mode']:.3f} | {blended_s2_m['mode']:.3f} |",
        f"| Below 0% | {blended_s1_m['below_zero_pct']:.1f}% | {blended_s2_m['below_zero_pct']:.1f}% |",
        f"| Above 90% | {blended_s1_m['above_90_pct']:.1f}% | 0.0% |",
        f"| P99 | {blended_s1_m['p99']:.3f} | {blended_s2_m['p99']:.3f} |",
        "",
        "### JavaScript Config",
        "```javascript",
        "const EMBEDDING_STATS = {",
        f"  esm2: {{ scale: {esm2_scale:.4f}, offset: {esm2_offset:.4f} }},",
        f"  hig2vec: {{ scale: {hig2vec_scale:.4f}, offset: {hig2vec_offset:.4f} }}",
        "};",
        "```"
    ]
    
    return "\n".join(lines)

def auto_fit_mode():
    """Auto-compute parameters to align modes to 0.5 and right-p99 to 0.9."""
    # ESM2: find scale and offset to map mode->0.5 and right-p99->0.9
    esm2_hist, esm2_bins = np.histogram(ESM2_RAW, bins=100)
    esm2_mode_idx = np.argmax(esm2_hist)
    esm2_mode = (esm2_bins[esm2_mode_idx] + esm2_bins[esm2_mode_idx + 1]) / 2
    
    # Right-side p99: values above mode
    esm2_right = ESM2_RAW[ESM2_RAW > esm2_mode]
    esm2_right_p99 = np.percentile(esm2_right, 99) if len(esm2_right) > 100 else np.percentile(ESM2_RAW, 99)
    
    # Solve: mode * scale + offset = 0.5
    #        right_p99 * scale + offset = 0.9
    # => scale = 0.4 / (right_p99 - mode)
    # => offset = 0.5 - mode * scale
    esm2_scale = 0.4 / (esm2_right_p99 - esm2_mode)
    esm2_offset = 0.5 - esm2_mode * esm2_scale
    
    # HiG2Vec: same process
    hig2vec_hist, hig2vec_bins = np.histogram(HIG2VEC_RAW, bins=100)
    hig2vec_mode_idx = np.argmax(hig2vec_hist)
    hig2vec_mode = (hig2vec_bins[hig2vec_mode_idx] + hig2vec_bins[hig2vec_mode_idx + 1]) / 2
    
    hig2vec_right = HIG2VEC_RAW[HIG2VEC_RAW > hig2vec_mode]
    hig2vec_right_p99 = np.percentile(hig2vec_right, 99) if len(hig2vec_right) > 100 else np.percentile(HIG2VEC_RAW, 99)
    
    hig2vec_scale = 0.4 / (hig2vec_right_p99 - hig2vec_mode)
    hig2vec_offset = 0.5 - hig2vec_mode * hig2vec_scale
    
    return esm2_scale, esm2_offset, hig2vec_scale, hig2vec_offset

# =============================================================================
# Tab 2: Ladder Comparison
# =============================================================================
def get_top15(target, esm2_weight=0.25):
    """Get top-15 neighbors for target gene."""
    if target not in COMMON_GENES:
        return None
    
    scores = []
    for gene in COMMON_GENES:
        if gene == target:
            continue
        
        esm2_cos = cosine(GENE_TO_ESM2[target], GENE_TO_ESM2[gene])
        hig2vec_cos = cosine(GENE_TO_HIG2VEC[target], GENE_TO_HIG2VEC[gene])
        
        esm2_s2 = stage2_clamp(stage1_transform(esm2_cos, 'esm2'))
        hig2vec_s2 = stage2_clamp(stage1_transform(hig2vec_cos, 'hig2vec'))
        
        score = esm2_weight * esm2_s2 + (1 - esm2_weight) * hig2vec_s2
        scores.append((gene, score, esm2_s2, hig2vec_s2))
    
    scores.sort(key=lambda x: x[1], reverse=True)
    return scores[:15]

def format_ladder(target, esm2_weight):
    """Format ladder as markdown table."""
    top15 = get_top15(target, esm2_weight)
    if not top15:
        return f"Gene '{target}' not found in database."
    
    lines = [f"## Top-15 Neighbors for {target}"]
    lines.append(f"**Blend:** {int(esm2_weight*100)}% Structural + {int((1-esm2_weight)*100)}% Functional\n")
    lines.append("| Rank | Gene | Display | Blended | ESM2 | HiG2Vec | Notes |")
    lines.append("|------|------|---------|---------|------|---------|-------|")
    
    for i, (gene, score, esm2, hig2vec) in enumerate(top15):
        rank = i + 1
        # Top 9 get ladder display (99% down to 91%), rest show raw blended score
        if rank <= 9:
            display = f"{100 - rank}%"
        else:
            display = f"{score*100:.1f}%"
        
        if esm2 > 0.65 and hig2vec > 0.75:
            notes = "BOTH HIGH"
        elif esm2 > 0.65 and hig2vec < 0.65:
            notes = "STRUCT ONLY"
        elif esm2 < 0.60 and hig2vec > 0.75:
            notes = "FUNC ONLY"
        else:
            notes = ""
        
        lines.append(f"| {rank} | {gene} | {display} | {score:.3f} | {esm2:.3f} | {hig2vec:.3f} | {notes} |")
    
    return "\n".join(lines)

def compare_ladders(target):
    """Compare structural, functional, and blended ladders (15 proteins each)."""
    if target not in COMMON_GENES:
        return f"Gene '{target}' not found."
    
    structural = get_top15(target, esm2_weight=1.0)
    functional = get_top15(target, esm2_weight=0.0)
    blended = get_top15(target, esm2_weight=0.25)
    
    lines = [f"# Ladder Comparison for {target}\n"]
    
    for label, ladder, weight in [
        ("Structural (100% ESM2)", structural, 1.0),
        ("Blended (25% ESM2 + 75% HiG2Vec)", blended, 0.25),
        ("Functional (100% HiG2Vec)", functional, 0.0)
    ]:
        lines.append(f"\n## {label}\n")
        lines.append("| Rank | Gene | Display | ESM2 | HiG2Vec | Notes |")
        lines.append("|------|------|---------|------|---------|-------|")
        
        for i, (gene, score, esm2, hig2vec) in enumerate(ladder):
            rank = i + 1
            # Display: top 9 get ladder-based %, rest show blended score
            if rank <= 9:
                display = f"{100 - rank}%"
            else:
                display = f"{score*100:.0f}%"
            
            if esm2 > 0.65 and hig2vec > 0.75:
                notes = "BOTH HIGH"
            elif esm2 > 0.65 and hig2vec < 0.65:
                notes = "STRUCT ONLY"
            elif esm2 < 0.60 and hig2vec > 0.75:
                notes = "FUNC ONLY"
            else:
                notes = ""
            lines.append(f"| {rank} | {gene} | {display} | {esm2:.3f} | {hig2vec:.3f} | {notes} |")
    
    return "\n".join(lines)

# =============================================================================
# Tab 3: Calibration (Live Blend Adjustment)
# =============================================================================
def live_ladder(target, esm2_pct):
    """Generate ladder with adjustable blend weight."""
    esm2_weight = esm2_pct / 100.0
    return format_ladder(target, esm2_weight)

# =============================================================================
# Tab 4: Validation
# =============================================================================
def run_validation():
    """Run validation test suite."""
    results = []
    
    # Test 1: HBB -> HBD should be rank 1
    hbb_ladder = get_top15('HBB', esm2_weight=0.25)
    hbb_top = hbb_ladder[0][0] if hbb_ladder else None
    hbd_rank = next((i+1 for i, (g, _, _, _) in enumerate(hbb_ladder) if g == 'HBD'), None)
    results.append(f"**HBB -> HBD:** Rank {hbd_rank} (expect 1) {'PASS' if hbd_rank == 1 else 'FAIL'}")
    
    # Test 2: BRCA1 should have no FUNC ONLY in top-5
    brca1_ladder = get_top15('BRCA1', esm2_weight=0.25)
    func_only_count = sum(1 for _, _, esm2, hig2vec in brca1_ladder[:5] if esm2 < 0.60 and hig2vec > 0.75)
    results.append(f"**BRCA1 top-5 FUNC ONLY entries:** {func_only_count} (expect 0) {'PASS' if func_only_count == 0 else 'FAIL'}")
    
    # Test 3: KRAS blended should exclude HRAS (structurally dissimilar)
    kras_ladder = get_top15('KRAS', esm2_weight=0.25)
    kras_genes = [g for g, _, _, _ in kras_ladder]
    hras_in_ladder = 'HRAS' in kras_genes
    results.append(f"**KRAS blended ladder contains HRAS:** {hras_in_ladder} (expect False) {'PASS' if not hras_in_ladder else 'FAIL'}")
    
    # Test 4: KRAS functional SHOULD have HRAS
    kras_func = get_top15('KRAS', esm2_weight=0.0)
    kras_func_genes = [g for g, _, _, _ in kras_func]
    hras_in_func = 'HRAS' in kras_func_genes
    results.append(f"**KRAS functional ladder contains HRAS:** {hras_in_func} (expect True) {'PASS' if hras_in_func else 'FAIL'}")
    
    # Test 5: TP53 blended should be all BOTH HIGH
    tp53_ladder = get_top15('TP53', esm2_weight=0.25)
    all_both_high = all(esm2 > 0.65 and hig2vec > 0.75 for _, _, esm2, hig2vec in tp53_ladder[:9])
    results.append(f"**TP53 blended top-9 all BOTH HIGH:** {all_both_high} {'PASS' if all_both_high else 'FAIL'}")
    
    # Summary
    passes = sum(1 for r in results if 'PASS' in r)
    results.append(f"\n**Total: {passes}/{len(results)-1} tests passed**")
    
    return "\n\n".join(results)

# =============================================================================
# Gradio Interface
# =============================================================================
with gr.Blocks(title="Similarity Toolkit") as demo:
    gr.Markdown("# Protein Similarity Toolkit")
    gr.Markdown("Explore ESM2 (structural) and HiG2Vec (functional) similarity metrics.")
    
    with gr.Tabs():
        # Tab 1: Interactive Normalization Explorer
        with gr.TabItem("Normalization Explorer"):
            gr.Markdown("""
            ### Interactive Distribution Alignment
            Adjust scale and offset for each embedding type to align their distributions.
            **Goal:** Align both modes to 0.5, right-side P99 to ~0.9. Red dotted line = target (0.5).
            """)
            
            with gr.Row():
                with gr.Column():
                    gr.Markdown("**ESM2 (Structural)**")
                    esm2_scale = gr.Slider(5, 40, value=23.06, step=0.1, label="Scale")
                    esm2_offset = gr.Slider(-30, 0, value=-21.99, step=0.1, label="Offset")
                with gr.Column():
                    gr.Markdown("**HiG2Vec (Functional)**")
                    hig2vec_scale = gr.Slider(0.1, 1.0, value=0.41, step=0.01, label="Scale")
                    hig2vec_offset = gr.Slider(0.0, 1.0, value=0.51, step=0.01, label="Offset")
            
            with gr.Row():
                auto_btn = gr.Button("Auto-Fit (Mode -> 0.5, Right-P99 -> 0.9)", variant="primary")
                reset_btn = gr.Button("Reset to Defaults")
            
            hist_plot = gr.Plot()
            metrics_output = gr.Markdown()
            
            # Auto-fit button
            def do_auto_fit():
                s1, o1, s2, o2 = auto_fit_mode()
                return s1, o1, s2, o2
            
            auto_btn.click(
                fn=do_auto_fit,
                outputs=[esm2_scale, esm2_offset, hig2vec_scale, hig2vec_offset]
            )
            
            # Reset button
            reset_btn.click(
                fn=lambda: (23.06, -21.99, 0.41, 0.51),
                outputs=[esm2_scale, esm2_offset, hig2vec_scale, hig2vec_offset]
            )
            
            # Live updates on slider change
            slider_inputs = [esm2_scale, esm2_offset, hig2vec_scale, hig2vec_offset]
            
            for slider in slider_inputs:
                slider.change(
                    fn=create_interactive_histogram,
                    inputs=slider_inputs,
                    outputs=hist_plot
                )
                slider.change(
                    fn=format_metrics,
                    inputs=slider_inputs,
                    outputs=metrics_output
                )
            
            # Initial load
            demo.load(
                fn=create_interactive_histogram,
                inputs=slider_inputs,
                outputs=hist_plot
            )
            demo.load(
                fn=format_metrics,
                inputs=slider_inputs,
                outputs=metrics_output
            )
        
        # Tab 2: Ladder Comparison
        with gr.TabItem("Ladder Comparison"):
            gr.Markdown("Compare structural, functional, and blended ladders for a gene.")
            gene_input = gr.Textbox(label="Gene Symbol", value="KRAS", placeholder="e.g. KRAS, TP53, HBB")
            compare_btn = gr.Button("Compare Ladders")
            ladder_output = gr.Markdown()
            compare_btn.click(fn=compare_ladders, inputs=gene_input, outputs=ladder_output)
        
        # Tab 3: Live Calibration
        with gr.TabItem("Calibration"):
            gr.Markdown("Adjust blend weight and see ladder change in real-time.")
            cal_gene = gr.Textbox(label="Gene Symbol", value="BRCA1")
            cal_slider = gr.Slider(0, 100, value=25, step=5, label="ESM2 Weight (%)")
            cal_output = gr.Markdown()
            cal_gene.change(fn=live_ladder, inputs=[cal_gene, cal_slider], outputs=cal_output)
            cal_slider.change(fn=live_ladder, inputs=[cal_gene, cal_slider], outputs=cal_output)
        
        # Tab 4: Validation
        with gr.TabItem("Validation"):
            gr.Markdown("Run test suite to validate normalization parameters.")
            val_btn = gr.Button("Run Validation Suite")
            val_output = gr.Markdown()
            val_btn.click(fn=run_validation, outputs=val_output)

if __name__ == "__main__":
    demo.launch()
