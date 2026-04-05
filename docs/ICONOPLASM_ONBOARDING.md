# Iconoplasm onboarding

If you are new to Iconoplasm, start here.

This is the short version of how the system is split up, what the homepage is supposed to do, and which mistakes not to repeat.

## what lives where

Iconoplasm is not one codebase pretending to be many things. It is two real systems with a browser extension attached.

### 1. the workstation / control plane

Path: `d:\Coding\Datasets\iconoplasm`

This is where local authoring happens.

It owns things like:

- candidate generation
- workstation sync
- local reconcile batching
- publish/export logic before the website sees it
- Website Ops payload generation

If something looks wrong before it reaches the live site, start there.

### 2. the website / runtime

Path: `d:\Coding\Website`

This repo is the public runtime.

It owns things like:

- the public Iconoplasm homepage and gene pages
- the Cloudflare Worker API in `workers/iconoplasm.js`
- the production D1 runtime tables
- the shared settings/auth bridge that connects `brinedew.bio` and `iconoplasm.brinedew.bio`

If the question is “what does the live site know right now?”, stay in this repo and query remote D1.

### 3. the browser extension

The extension produces discovery events. The website displays the resulting shelf.

Important consequence: if discovery behavior looks wrong on the site, do not assume it is only a frontend problem. The contract between extension, worker, and homepage matters.

## the homepage has two real modes

This is the architectural rule that caused the biggest confusion.

### personal shelf / pokedex mode

Who gets it:

- every normal signed-in user
- admins when the admin toggle is off

What it shows:

- the signed-in user's own discovered genes

What API drives it:

- `GET /api/iconoplasm/discoveries/me`

What it is **not**:

- not the full catalog
- not a fake "every gene is discovered" shelf

### classic full gallery mode

Who gets it:

- admins only, when the browser setting `showAllGenes` is on

What it shows:

- the old full-catalog gallery

What API drives it:

- `GET /api/public/v1/gallery`

What it is **not**:

- not `discoveries/me?show_all=1` with a giant payload pretending the full catalog is a discovered shelf

If you are debugging the homepage, figure out which of these two modes should be active **before** touching code.

## starter genes are part of the contract

There is a starter trio:

- `INS`
- `LEP`
- `GCG`

### signed-out visitors

Guests can be shown the starter trio as a lightweight, browser-only introduction to the shelf idea.

### signed-in users

Signed-in users must never have a true zero-state shelf.

That means the starter trio must exist as real discovery rows for an authenticated user. If the live homepage shows an authenticated user with `0` discovered genes, treat that as a bug.

Do **not** fix that by painting different text in the browser while leaving the API empty. The worker must uphold the contract.

## which route should fire

When the homepage loads, check this table first.

| situation | expected route |
|---|---|
| signed out | public gallery counts + guest starter UI |
| signed in, normal user | `/api/iconoplasm/discoveries/me` |
| signed in, admin, classic toggle off | `/api/iconoplasm/discoveries/me` |
| signed in, admin, classic toggle on | `/api/public/v1/gallery` |

If the wrong route is firing, you are debugging the wrong problem.

## the settings bridge matters

The canonical site settings live on `brinedew.bio`, but Iconoplasm runs on `iconoplasm.brinedew.bio`.

So the homepage has to wait for the shared settings bridge before it decides which mode to load.

Why this matters:

- admin-only settings like classic gallery mode live in that shared settings state
- if the homepage races ahead before the bridge resolves, it can silently load the wrong mode

In practice: if admin mode seems ignored on first load, inspect the settings bridge before blaming the gallery API.

## debugging checklist

Do these in order.

1. **Figure out which system owns the bug.**
   - workstation/control-plane problem → `d:\Coding\Datasets\iconoplasm`
   - live runtime problem → `d:\Coding\Website`

2. **Figure out which homepage mode should be active.**
   - personal shelf or classic gallery

3. **Check auth state.**
   - signed out and signed in are different products here, not just different copy

4. **Check the real route being called in the browser.**
   - do not infer from the UI text alone

5. **Query remote D1 if the question is about production data.**
   - use `--remote`
   - do not assume local dev data matches prod

6. **Check Git history before redesigning behavior.**
   - if something “used to work,” look at the recent commits first
   - do not reinvent an older working behavior because you forgot to look at Git

7. **Fix the root cause.**
   - do not add timeouts or fallbacks that hide architectural mistakes

## operational rules that are easy to get wrong

### do not guess from frontend state

If the question is about what production knows, query remote D1.

### do not turn indexed joins into scans

`icono_gene_catalog`, `icono_gene_essence`, and `icono_gene_discoveries` already store canonical uppercase `gene_symbol` keys.

That means joins should look like this:

```sql
ON ge.gene_symbol = d.gene_symbol
```

Not this:

```sql
ON upper(ge.gene_symbol) = upper(d.gene_symbol)
```

Wrapping both sides in `upper(...)` looks harmless, but it can blow away index use and make the homepage feel hung.

### do not build giant fake shelf payloads

If you try to represent the full catalog as one huge discovered shelf response, you can hit size problems like `SQLITE_TOOBIG` or just make the route painfully slow.

Use the right mode and the right route instead.

### do not “fix” the product with fallbacks

If personal shelf mode is broken, fix personal shelf mode.

If classic gallery mode is broken, fix classic gallery mode.

Do not quietly switch users to some other mode and call it done.

## deployment and validation

### normal release

- commit the fix
- push `main`
- let the production workflow deploy

### worker-only hotfix or live debugging

There is also a verified manual worker path from this repo:

- from `d:\Coding\Website`, run `npx wrangler deploy`
- or use the VS Code task `Deploy iconoplasm worker now`

If you do that, still commit and push right away so Git and production do not drift apart.

### always validate on the real page

Do not stop at “tests passed.”

For homepage bugs, validate the actual DOM on `https://iconoplasm.brinedew.bio/` and confirm the expected route/mode/counts are real.

## if you only remember five things

1. Workstation problems and live-site problems are not the same repo.
2. Personal shelf mode and classic gallery mode are not the same product path.
3. Signed-in users should never have a real zero-state shelf.
4. Remote D1 answers production questions; local assumptions do not.
5. Check Git before reinventing behavior that already existed.