# dsh-knowledge v4.0.0 Reliability Release Implementation Plan

## Scope

Implement the directory-source identity and synchronization work specified in
`docs/superpowers/specs/2026-09-15-dsh-knowledge-4.0-reliability-design.md`
(issue #20), fold in the completed #16–#18 fixes and the #22 installation
recovery documentation, and prepare the v4.0.0 release.

Ordering note: the host synchronization engine and the panel confirmation were
implemented before this plan was written, because the earlier session was
interrupted by a quota limit rather than by a design question. The commit
sequence below records what actually landed; each commit was verified with a
clean typecheck and the full test suite before it was created.

## Implementation steps

1. Replace the four separate directory paths (first import, repeat import,
   single-file reindex, base-wide background reindex) with one diff engine
   keyed on `(baseId, canonical real path)`. Commit as
   `fix(knowledge): unify directory sources on one idempotent sync path`.
2. Return itemized `created`/`updated`/`unchanged`/`deleted`/`failed` results
   with a truthful `synced`/`unchanged`/`partial` aggregate; never report an
   unchanged file as a failure, and never wrap a mostly-successful sync into an
   overall failure. In the same commit, add the `delete-impact` preview and the
   explicit `recursive` gate for non-empty directories.
3. Expose `sourcePath` on administrative summaries and details, keep it out of
   model-facing search hits, and make a single-file reindex re-read disk.
4. Read the delete impact in the management panel before any destructive call
   and require a second confirmation that names the exact scope. Commit as
   `feat(ui): confirm cascading deletes with the host-reported impact`.
5. Merge `docs/install-recovery-guidance` (#22) into the release branch.
6. Update `package.json` and `dsh.plugin.json` to `4.0.0`; add the 2026-09-15
   section at the top of `CHANGELOG.md`; create `docs/releases/v4.0.0.md`;
   update both READMEs' installation example and current-release highlights
   without rewriting the v0.3.9 historical notes.
7. Run `npm run release:check` from a clean committed tree: build policy
   verification, release metadata verification, production audit, typecheck,
   the full Vitest suite, the retrieval benchmark, the deterministic build, and
   package verification.
8. Confirm the npm tarball metadata and that required files include the
   v4.0.0 release note and every runtime worker.
9. Push the branch, identify the CI run for the exact release commit, and wait
   for the required jobs: quality CI on Node 22.19, 24, and 26, and native CI
   on Ubuntu, Windows, and macOS. Run the real local embedding and local rerank
   smoke jobs, treating a deliberately skipped manual job as allowed.
10. Create annotated tag `v4.0.0` on the verified release commit and push it.
11. Create a GitHub Release Draft from `docs/releases/v4.0.0.md` and report the
    exact npm command and verified tarball metadata to the maintainer. Do not
    invoke `npm publish`.
12. After the maintainer reports publication, verify
    `npm view dsh-knowledge version` equals `4.0.0`, then publish the GitHub
    Release draft.

## Verification for the acceptance criteria

- Re-importing the same canonical directory reuses the original root and
  synchronizes it: `tests/domain-store.spec.ts` asserts `mode: 'synced'`, a
  stable `sourceId`, and exactly one top-level root.
- File identity is directory source plus relative path, and a legacy duplicate
  root is refused: the same spec asserts `ambiguous_source` and that neither
  tree is removed.
- Itemized results with a truthful aggregate: the spec asserts `updated`,
  `created`, and `deleted` counts plus `unchanged` for a repeat import.
- `sourcePath` is available on administrative reads and drives a live file
  reindex; the base-wide background reindex reaches tracked roots.
- The recursive delete gate and its impact preview are asserted end to end.
- The panel contract is locked by `tests/ui-policy.spec.ts`.

## Stop conditions

- Stop before tagging if any local release gate or required GitHub CI job fails.
- Stop before publishing the GitHub Release if npm does not report 4.0.0.
- Stop and request direction before changing a pushed release tag, and never
  merge, move, or delete a user's historical duplicate directory tree
  automatically.
