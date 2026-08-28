# Iconoplasm release integrity

The human GUI remains the only publish authority. Ordinary builds, tests and
source deployments do not authorize a new extension version or store submission.

## Development identity

Validation packages display `Iconoplasm DEV <fingerprint>` and a development
`version_name`. Their `build-info.json` records the channel, base version and
SHA-256 of the actual staged runtime inputs. This works without Git in an AMO
source archive and distinguishes dirty development code from the released ZIP.
The numeric manifest version remains the catalog compatibility version; it is
never evidence that development bytes equal a published package.

The packagers accept `--out-dir=<directory>` for disposable test/build outputs.
WXT inputs use a unique temporary directory inside the project so Vite resolves
the project's locked dependencies; the directory is removed on completion or
failure. Tests put sentinel ZIPs only in disposable output roots. No test backs
up, replaces or restores a real release ZIP.

## One source identity and one immutable archive

1. The GUI checks source/build inputs are committed, advances the explicitly
   approved version, creates the new Chrome download exclusively, and commits
   the release metadata and package. Existing public versions cannot be replaced.
2. It checks GitHub immutable releases are enabled, then pins
   `iconoplasm-v<version>` to the full release commit SHA. A retry may reuse the
   same tag/commit; it cannot move the tag. Both workflows dispatch from this tag
   with the same expected SHA, never from a moving `main` branch.
3. The shared preparation workflow waits for successful CI on that exact commit.
   CI rejects changes/deletions to previously published downloads and reproduces
   any newly added Chrome package from the committed source. Website deployment
   waits for the same CI result before exposing the download.
4. Preparation builds Firefox, Edge and Firefox reviewer source once. It verifies
   the reviewer rebuild and compares every Chrome payload file against the
   GUI-approved ZIP. ZIP timestamps may differ; uploaded Chrome bytes are the
   original approved bytes, not the verification rebuild.
5. A draft GitHub release receives all four ZIPs and `iconoplasm-release.json`.
   The manifest binds version, full commit, tag, repository, exact filenames,
   sizes and SHA-256 hashes. Uploaded GitHub digests must match before publication.
   Publication locks the tag/assets. Downloading and verifying the sealed archive
   is a required postcondition, not an assumed success.
6. Store jobs download that immutable archive and check its identity and every
   artifact hash. They do not rebuild packages. Separate store signing/review can
   transform the signed deliverable; the exact submitted bundles remain archived.

The preparation jobs serialize by version. A failed draft can be retried before
publication. Once sealed, it is reused without uploading anything. A source or
byte mismatch fails; the remedy is a newly authorized version. If an administrator
disables repository immutability, the GUI refuses dispatch and CI's postcondition
refuses store consumption of a mutable release. Store jobs do not receive an
administration token merely to read that admin-only setting.

## Verification and boundaries

Tests cover source/tag mismatch, changed bytes under one version, interrupted
drafts, failed upload digests, corrupt downloads, missing assets, development
packages, public-file replacement/deletion, and exact reviewer reproduction.
Local mocked GitHub tests do not certify live store submission. Record the first
human-authorized run's immutable release and installed-store checks in B-707.

The existing 0.5.3 public ZIP remains unchanged. Enabling immutable releases does
not retroactively invent or certify historical GitHub releases. No historical
version may be republished from current development source.

References: [GitHub immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)
and [SemVer's released-package rule](https://semver.org/#spec-item-3).
