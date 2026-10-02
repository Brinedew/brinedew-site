# Factory retirement contract

The authoring authority is the workstation's immutable factory registry; its
public projection is `workers/generated/iconoplasm-factory-catalog.js`. Each
pipeline letter there carries `status: accepted` or `status: retired`. The
mutable website pointer chooses a Pipeline/Vision for future work only.

A replacement model gets a new letter. The retired letter keeps its original
definition, and existing images and queued recipe snapshots keep the letter
they were made with; they are never relabeled to the replacement.

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
