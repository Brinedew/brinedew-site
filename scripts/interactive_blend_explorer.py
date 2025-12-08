#!/usr/bin/env python3
"""
Interactive scatterplot to explore ESM2 vs HiG2Vec similarity blending.
Uses Plotly Dash for real-time alpha slider adjustment.

Run: python scripts/interactive_blend_explorer.py
Then open http://127.0.0.1:8050 in browser
"""
import json
import random
import numpy as np
import torch
from pathlib import Path
from dash import Dash, dcc, html, Input, Output, callback
import plotly.express as px
import plotly.graph_objects as go

print("Loading embeddings...")

# Load data
proteins_file = Path(r"D:\Coding\Datasets\GeneGuessr\output\proteins.json")
with open(proteins_file) as f:
    proteins = json.load(f)

esm2_file = Path(r"D:\Coding\Datasets\GeneGuessr\cache\ESM2-vectors\ESM2-3B-Human-Gene-Embeddings.pt")
esm2_data = torch.load(esm2_file)
gene_to_esm2 = {gene: vec.to(torch.float16).to(torch.float32).numpy() for gene, vec in esm2_data.items()}

hig2vec_file = Path(r"D:\Coding\Datasets\GeneGuessr\cache\Hig2Vec\hig2vec_human_200dim.pth")
hig2vec_pt = torch.load(hig2vec_file)
objects = hig2vec_pt['objects']
embeddings = hig2vec_pt['embeddings']
gene_to_hig2vec = {obj: embeddings[i].numpy() for i, obj in enumerate(objects) if not obj.startswith('GO:')}

gene_to_protein = {p["gene"]: p for p in proteins}
common_genes = list(set(gene_to_esm2.keys()) & set(gene_to_hig2vec.keys()) & set(gene_to_protein.keys()))
print(f"Common genes: {len(common_genes)}")

def cosine_similarity(v1, v2):
    dot = np.dot(v1, v2)
    norm1 = np.linalg.norm(v1)
    norm2 = np.linalg.norm(v2)
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return dot / (norm1 * norm2)

# Precompute 10k random pairs
print("Computing 10k random protein pairs...")
n_pairs = 10000
pairs = []
for _ in range(n_pairs):
    g1, g2 = random.sample(common_genes, 2)
    esm2_sim = cosine_similarity(gene_to_esm2[g1], gene_to_esm2[g2])
    hig2vec_sim = cosine_similarity(gene_to_hig2vec[g1], gene_to_hig2vec[g2])
    pairs.append({
        'gene1': g1,
        'gene2': g2,
        'esm2': esm2_sim,
        'hig2vec': hig2vec_sim,
    })

esm2_sims = np.array([p['esm2'] for p in pairs])
hig2vec_sims = np.array([p['hig2vec'] for p in pairs])
labels = [f"{p['gene1']} vs {p['gene2']}" for p in pairs]

# Precompute z-scores (for z-score blending mode)
esm2_mean, esm2_std = esm2_sims.mean(), esm2_sims.std()
hig2vec_mean, hig2vec_std = hig2vec_sims.mean(), hig2vec_sims.std()
esm2_z = (esm2_sims - esm2_mean) / (esm2_std + 1e-8)
hig2vec_z = (hig2vec_sims - hig2vec_mean) / (hig2vec_std + 1e-8)

print(f"ESM2 range: [{esm2_sims.min():.3f}, {esm2_sims.max():.3f}], mean={esm2_mean:.3f}, std={esm2_std:.3f}")
print(f"HiG2Vec range: [{hig2vec_sims.min():.3f}, {hig2vec_sims.max():.3f}], mean={hig2vec_mean:.3f}, std={hig2vec_std:.3f}")

# Build Dash app
app = Dash(__name__)

app.layout = html.Div([
    html.H1("ESM2 vs HiG2Vec Similarity Explorer", style={'textAlign': 'center', 'color': '#fff'}),
    
    html.Div([
        html.Div([
            html.Label("ESM2 Weight (α)", style={'fontWeight': 'bold', 'color': '#fff'}),
            dcc.Slider(
                id='alpha-slider',
                min=0, max=1, step=0.05,
                value=0.5,
                marks={i/10: {'label': f'{i/10:.1f}', 'style': {'color': '#ccc'}} for i in range(0, 11)},
                tooltip={"placement": "bottom", "always_visible": True}
            ),
        ], style={'width': '45%', 'display': 'inline-block', 'padding': '20px'}),
        
        html.Div([
            html.Label("Blending Mode", style={'fontWeight': 'bold', 'color': '#fff'}),
            dcc.RadioItems(
                id='blend-mode',
                options=[
                    {'label': ' Raw Cosine (current)', 'value': 'raw'},
                    {'label': ' Z-Score Normalized', 'value': 'zscore'},
                ],
                value='raw',
                inline=True,
                style={'color': '#fff'}
            ),
        ], style={'width': '45%', 'display': 'inline-block', 'padding': '20px'}),
    ], style={'textAlign': 'center'}),
    
    html.Div([
        dcc.Graph(id='scatter-plot', style={'height': '70vh'}),
    ]),
    
    html.Div(id='stats-display', style={
        'textAlign': 'center', 
        'padding': '20px',
        'fontSize': '16px',
        'fontFamily': 'monospace',
        'backgroundColor': '#222',
        'color': '#fff',
        'borderRadius': '8px',
        'margin': '20px'
    }),
], style={'backgroundColor': '#111', 'minHeight': '100vh', 'color': '#fff'})

@callback(
    [Output('scatter-plot', 'figure'),
     Output('stats-display', 'children')],
    [Input('alpha-slider', 'value'),
     Input('blend-mode', 'value')]
)
def update_plot(alpha, blend_mode):
    # Position interpolation based on alpha
    # At alpha=0: x=hig2vec, y=0 (pure HiG2Vec)
    # At alpha=1: x=0, y=esm2 (pure ESM2)
    # At alpha=0.5: x=0.5*hig2vec, y=0.5*esm2
    
    if blend_mode == 'raw':
        x_pos = (1 - alpha) * hig2vec_sims
        y_pos = alpha * esm2_sims
        blended = alpha * esm2_sims + (1 - alpha) * hig2vec_sims
        mode_label = "Raw Cosine"
    else:
        x_pos = (1 - alpha) * hig2vec_z
        y_pos = alpha * esm2_z
        blended = alpha * esm2_z + (1 - alpha) * hig2vec_z
        mode_label = "Z-Score Normalized"
    
    # Create figure
    fig = go.Figure()
    
    # Scatter plot with blended similarity as color
    fig.add_trace(go.Scattergl(
        x=x_pos.tolist(),
        y=y_pos.tolist(),
        mode='markers',
        marker=dict(
            size=5,
            color=blended.tolist(),
            colorscale='Plasma',
            colorbar=dict(
                title=dict(text='Blended<br>Similarity', font=dict(color='white')),
                tickfont=dict(color='white'),
            ),
            opacity=0.7,
            cmin=float(blended.min()),
            cmax=float(blended.max()),
        ),
        text=labels,
        customdata=np.column_stack([hig2vec_sims, esm2_sims, blended]).tolist(),
        hovertemplate=(
            '<b>%{text}</b><br>'
            'HiG2Vec (raw): %{customdata[0]:.4f}<br>'
            'ESM2 (raw): %{customdata[1]:.4f}<br>'
            'Blended: %{customdata[2]:.4f}<extra></extra>'
        ),
    ))
    
    # Dynamic axis ranges based on mode
    if blend_mode == 'raw':
        x_range = [-0.1, hig2vec_sims.max() + 0.1]
        y_range = [-0.05, esm2_sims.max() + 0.05]
    else:
        max_z = max(abs(hig2vec_z).max(), abs(esm2_z).max()) + 0.5
        x_range = [-max_z, max_z]
        y_range = [-max_z, max_z]
    
    fig.update_layout(
        title=dict(
            text=f'Protein Pair Similarities | alpha={alpha:.2f} ({mode_label})',
            x=0.5,
            font=dict(size=18, color='white')
        ),
        xaxis=dict(
            title=dict(text=f'HiG2Vec contribution: (1-alpha) x sim = {1-alpha:.2f} x sim', font=dict(color='white')),
            range=x_range,
            gridcolor='#333',
            zerolinecolor='#555',
            tickfont=dict(color='white'),
        ),
        yaxis=dict(
            title=dict(text=f'ESM2 contribution: alpha x sim = {alpha:.2f} x sim', font=dict(color='white')),
            range=y_range,
            gridcolor='#333',
            zerolinecolor='#555',
            tickfont=dict(color='white'),
        ),
        template='plotly_dark',
        paper_bgcolor='#111',
        plot_bgcolor='#111',
        hovermode='closest',
    )
    
    # Compute correlation between blended and each source
    from scipy.stats import spearmanr
    rho_esm2, _ = spearmanr(blended, esm2_sims)
    rho_hig2vec, _ = spearmanr(blended, hig2vec_sims)
    
    # Stats text
    stats = html.Div([
        html.Span(f"Spearman rho(blend, ESM2) = {rho_esm2:.3f}", style={'marginRight': '40px'}),
        html.Span(f"Spearman rho(blend, HiG2Vec) = {rho_hig2vec:.3f}", style={'marginRight': '40px'}),
        html.Span(f"Blend range: [{blended.min():.3f}, {blended.max():.3f}]"),
    ])
    
    return fig, stats

if __name__ == '__main__':
    print("\n" + "="*60)
    print("Starting Dash server at http://127.0.0.1:8050")
    print("="*60 + "\n")
    app.run(debug=True, host='127.0.0.1', port=8050)
