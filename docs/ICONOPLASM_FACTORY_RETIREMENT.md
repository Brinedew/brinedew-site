# Factory retirement contract

The authoring authority is the Iconoplasm dataset factory registry; its public
projection is `workers/generated/iconoplasm-factory-catalog.js`. The mutable
website pointer chooses a Pipeline/Vision for future work only.

## B-714: Turbo 1.0 to 1.1

E/L retain their original Turbo 1.0 identities with `status: retired`.
O/P are new Turbo 1.1 definitions at 896x1152 and 1536x2048. They use 10 steps,
CFG 1, Euler and recommend existing Vision 9. Existing images and queued recipe
snapshots must never be relabeled as O/P. An unrelated active H9 stays H9.

The model replacement procedure and official file hash live in the workstation
runbook `docs/FACTORY_MODEL_CUTOVER.md` and Linear B-714.

## Chesterton's fence

Pipeline normalization and execution admission are different operations:

- `normalizeFactoryPipelineCode` recognizes historical retired letters, because
  receipts, emulsion identifiers and old diagnostic matrices still reference them.
- `factoryPipelineCatalog` exposes accepted definitions for future selection.
- Activation, Vision recommendations and new diagnostic matrices separately
  require accepted status. Mixed accepted/retired diagnostic requests reject the
  whole request; they must not silently remove requested rows.
- A retired active pointer fails clearly. Never silently substitute A or another
  model: the operator must select an accepted recipe.

Do not solve retirement by removing old definitions from the catalog, or by
renaming a model under an existing letter. Both corrupt historical identity.
Do not solve it only by hiding options: direct requests and saved local paths
must also reject retired factories. The factory-recipe tests exercise these
boundaries against the actual runtime functions.
