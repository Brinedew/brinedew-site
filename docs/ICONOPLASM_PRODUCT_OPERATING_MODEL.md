# Iconoplasm product operating model

This document defines what Iconoplasm must do for people. It does not prescribe
how the implementation achieves it.

## Product promise

Iconoplasm turns human genes and proteins into memorable characters in one
shared world. A reader should be able to recognize a gene while reading, recall
its character later, explore its dossier, and participate in choosing the
public canon.

The database, queues, caches, Workers, storage providers, and synchronization
machinery support that experience. They are not product requirements.

## Core user loop

1. The extension recognizes a gene or protein in what the reader is already
   reading.
2. Hover reveals the published identity without disrupting the document.
3. A deliberate encounter can become part of the reader's personal discovery
   shelf.
4. The gene dossier provides the full character, biological context, candidate
   portraits, requests, comments, and voting.
5. Accepted votes and authoring changes eventually produce one coherent public
   canon across the site, extension, archive, and public interfaces.

## Durable requirements

### One canon

Every public surface must agree on the selected character and image for a gene.
Caches and accelerators may copy canonical bytes, but they do not choose canon.
A failure must not create a second authority or silently mix versions.

### Reading remains usable

Opening an article, browsing the archive, searching, and viewing a published
gene must remain available when authoring, voting, synchronization, or a
provider is degraded. Existing open reading contexts may stay coherent rather
than changing underneath the reader.

### Accepted actions are durable

When the product tells a person that a discovery, vote, request, or authoring
change was accepted, that action must survive retries and restarts. Overload may
delay nonessential work, but it must not fabricate success or lose accepted
intent.

### Freshness is bounded but subordinate to correctness

New page loads and reloads should converge on a new winning canon promptly under
healthy operation. An already-open article does not need continuous polling.
A slower coherent update is better than quota exhaustion, mixed canon, or
interrupting reading.

### Affordable growth boundary

Keep ordinary reading available on the account's current plan. Do not treat a
synthetic visitor count, recent agent-driven maintenance traffic, or a paid
Cloudflare upgrade as the product goal. Measure actual reader and editor
journeys separately from migrations, backfills, publication, tests, and other
operator work. When capacity fails, identify the action and query consuming it,
then remove needless work before proposing a larger allowance.

## Surface ownership

| Surface                  | User job                                       | Durable owner                                        |
| ------------------------ | ---------------------------------------------- | ---------------------------------------------------- |
| Extension hover          | Recognize a gene while reading                 | Published canon plus bounded local reuse             |
| Gene dossier             | Understand, compare, vote, request, and author | Published canon plus explicit private/mutation state |
| Homepage and Clans       | Resume a personal memory trail                 | The reader's durable discovery state                 |
| Gene archive             | Browse a stable complete reference             | Published canon                                      |
| Local workstation        | Create and curate source material              | Local authoring system                               |
| Public APIs and releases | Reuse the same public canon elsewhere          | Publication system                                   |

An implementation may move storage or computation between components without
changing this contract, provided these ownership boundaries and user outcomes
remain true.

## Requirements versus evidence

A requirement states a user-visible outcome or a resource boundary. It must not
freeze a query, schema, queue, cache, retry, provider operation, incident repair,
or current code path.

Operational numbers belong in dated evidence produced by tests, provider
telemetry, or load runs. They expire when the relevant code, workload, or
provider contract changes. Historical evidence may explain a decision, but it
must never become an instruction merely because it is detailed.

When prose and executable reality disagree:

1. verify the current implementation and provider state;
2. preserve the durable product requirements above;
3. change or delete the stale prose;
4. do not preserve an implementation solely because an old document priced it.

## Evidence required for a capacity claim

A claim that a measured reader workload is supported must include:

- the tested reader journeys and their declared assumptions;
- current provider allowances and account-wide competing use;
- measured or conservatively bounded work for every material resource;
- cold, warm, burst, retry, and provider-degradation cases;
- user-visible behavior at and beyond admission limits;
- enough margin that ordinary variation does not consume the entire allowance.

A passing component benchmark is not whole-product proof. A failing synthetic
scenario is not a product requirement.

## Current-state entrypoints

- Public request boundaries:
  [ICONOPLASM_REQUEST_LIFECYCLE.md](ICONOPLASM_REQUEST_LIFECYCLE.md)
- Capacity and incident operation:
  [ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md](ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md)
- Executable architecture markers: `architecture-fences.json`
- Current delivery work and observed defects: Linear

Completed plans, incident reports, old issue descriptions, and historical
capacity tables are evidence only. They are not current requirements.
