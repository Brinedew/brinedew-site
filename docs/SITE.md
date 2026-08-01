# Brinedew.bio site topology

This is the short, current topology map for a fresh agent. The executable
source of truth is `cloudflare/deployment-topology.json`; this page explains
what the fields mean and points to the detailed lifecycle runbook.

## One state owner

Iconoplasm's custom hostname is owned directly by the existing Cloudflare
script `geneguessr-api`. The two deliberately loud source filenames below are
composition boundaries, not invitations to create similarly named copies:

| Boundary                                                                                          | Owns                                                                                  | Must not become                                           |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `workers/the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js`                   | Cloudflare fetch dispatch, Durable Objects, Queues, migrations, and binding ownership | a thin proxy to another stateful Worker                   |
| `workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js` | Iconoplasm public reads, publication, admin, and write paths inside that same Worker  | a second state owner or a public `iconoplasm-web` service |

There is no normal public service-binding hop for Iconoplasm requests. Static
assets are served by Workers Static Assets before JavaScript Worker execution;
dynamic misses enter `geneguessr-api` once. The topology manifest and the
Wrangler configuration must continue to agree on this route owner.

## Route table

| Host/path                                   | First owner           | Dynamic owner      | State                                    |
| ------------------------------------------- | --------------------- | ------------------ | ---------------------------------------- |
| `iconoplasm.brinedew.bio/<published asset>` | Workers Static Assets | none               | immutable build output                   |
| `iconoplasm.brinedew.bio/gene/<SYMBOL>`     | Static Assets miss    | `geneguessr-api`   | published KV read plane plus HTML cache  |
| `iconoplasm.brinedew.bio/api/*`             | Static Assets miss    | `geneguessr-api`   | existing Iconoplasm read/write contracts |
| `iconoplasm.brinedew.bio/health`            | Static Assets miss    | `geneguessr-api`   | bounded health response                  |
| `brinedew.bio/*`                            | public edge Worker    | public edge Worker | separate Brinedew site boundary          |

## Deployment graph

The production workflow applies migrations, deploys the stateful Worker,
reconciles ownership, uploads the public edge Worker, publishes Pages assets,
and activates the final HTML-shell cache version. The stateful Worker is not
skipped when a release is “only CSS”: every new version must be cold-safe.

Run `pnpm run validate:iconoplasm-topology` before changing the route or
deployment graph. It rejects missing protected files, a changed Cloudflare
script name, a changed route owner, a public proxy declaration, and shortened
protected filenames.

## Naming contract

The prefix/suffix convention is an architecture guard, not style noise. Keep
the exact protected names. New modules may be descriptive inside
`workers/iconoplasm/<responsibility>/`, but they must retain the `iconoplasm-`
identity in their path or filename and must never use a vague catch-all such as
`handler.js` or `utils.js`. See `workers/iconoplasm/AGENTS.md` and
`docs/ICONOPLASM_REQUEST_LIFECYCLE.md` before extracting code.

## Anti-ping-pong rule

The rejected design was “public proxy → stateful Worker”. It charged two
Worker invocations for dynamic reads and made ownership easy to misread. Do
not recreate it under a new service name, a service binding, a “lightweight”
edge Worker, or an `iconoplasm-web` directory. Refactoring means smaller
responsibility modules behind the same route and state owner, not a new
invocation topology.
