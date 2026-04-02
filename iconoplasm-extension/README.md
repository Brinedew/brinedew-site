# Iconoplasm Extension

This folder is the canonical unpacked Chrome extension root for Iconoplasm.

Chesterton's fence: this folder is the runtime client, not the authoring workstation. If the published catalog, alias export, or Website Ops payload looks wrong, start in `d:\Coding\Datasets\iconoplasm` first. That sibling repo is the local control plane that publishes the catalog facts this extension consumes.

Reason for the move:

- keep the extension code easy to find from the website repo
- keep the tooltip/frontpage design work close together
- avoid losing track of the relevant files across two unrelated locations
- keep a single source of truth for local Chrome testing and future store packaging
