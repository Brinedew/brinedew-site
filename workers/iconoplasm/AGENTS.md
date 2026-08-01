# Iconoplasm extracted-module boundary

This directory is the only approved home for responsibility-based modules
extracted from the protected Iconoplasm runtime. It is not a Worker entrypoint
and it must not acquire a Wrangler script, route, Durable Object, Queue, or
service binding.

## Owns

- small, contract-tested public-read, rendering, publication, and stateful-write
  modules that are imported by the existing protected runtime;
- explicit resource names such as `gene-document.js`,
  `gene-route-record.js`, and `gene-page-html-cache.js`;
- tests that prove import boundaries and preserve the one dynamic invocation.

## Must not own

- a second Cloudflare Worker or public proxy;
- a duplicate state owner, route declaration, or service-binding hop for normal
  Iconoplasm reads;
- vague catch-all files such as `handler.js`, `utils.js`, `runtime.js`, or a
  shortened `iconoplasm-web` service;
- publication repair, D1 mutation, or admin authority in public-read modules.

## Naming rules

Keep the protected top-level filenames exactly as they are. Inside this
directory use `<responsibility>/<resource>.js`, retain the `iconoplasm-`
identity when a file is moved back to a shared workers root, and put an
explicit version on serialized contracts. Responsibility names supplement the
protective prefix/suffix; they never replace it.

## Required checks

Run `pnpm run validate:iconoplasm-topology` and the focused cold-path tests
before changing topology. Run the full `pnpm test` and the Wrangler dry run
before deployment. If an extraction needs a new binding or route, stop and
update `cloudflare/deployment-topology.json`, `architecture-fences.json`, and
the Linear issue first.
