# GeneGuessr Eval

An [Inspect AI](https://inspect.aisi.org.uk/) evaluation that tests whether LLMs can identify human proteins from biological clues.

## What it tests

The agent plays GeneGuessr: given masked biological clues about a mystery protein (function, structure, tissue expression, etc.), it must search a database of ~20K human proteins, reason about similarity scores, spend hint credits strategically, and ultimately identify the target.

This tests:
- **Domain knowledge**: biochemistry, protein families, gene naming conventions
- **Strategic reasoning**: when to guess vs. search vs. reveal hints
- **Information integration**: combining partial clues with similarity feedback
- **Resource management**: 10 guesses, limited hints, 50-action budget

## Quick start

```bash
# Install
cd eval/geneguessr
pip install -e .

# Run against a model (needs GENEGUESSR_BENCH_API_KEY env var)
inspect eval geneguessr_eval/task.py --model openai/gpt-4o

# Run with specific proteins for reproducibility
inspect eval geneguessr_eval/task.py --model openai/gpt-4o -T n_samples=5
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GENEGUESSR_BENCH_API_KEY` | Yes | API key for the benchmark Worker |
| `GENEGUESSR_BENCH_URL` | No | Override base URL (default: `https://geneguessr-bench.brinedew.bio`) |

## Tools available to the agent

| Tool | Description |
|------|-------------|
| `search_proteins(query)` | Search ~20K human proteins by name, gene symbol, or keyword |
| `guess_protein(uniprot_id)` | Submit a guess -- returns similarity score and structural comparison |
| `reveal_hint(hint_id)` | Spend a hint credit to unmask a clue section |
| `get_current_clues()` | View current clue state (what's masked vs revealed) |

## Scoring

- **Primary metric**: `max_similarity` -- highest similarity score achieved (0.0-1.0)
- **Secondary metric**: `exact_match` -- did the agent guess the exact protein?
- Additional metadata: guesses used, hints used, actions taken

## Architecture

```
Agent (LLM)
  |  calls @tool functions
  v
Inspect harness (this code)
  |  makes HTTP requests
  v
Benchmark Worker (geneguessr-bench.brinedew.bio)
  |  queries
  v
D1 database (~20K human proteins)
```

The agent never sees HTTP, URLs, or API keys. It just calls Python tool functions.
