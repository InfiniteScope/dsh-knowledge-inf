# dsh-knowledge 0.4.0 reliability design

**Date:** 2026-09-15
**Status:** Approved design; implementation has not started

## Purpose

Deliver a single, compatibility-preserving 0.4.0 release that includes the
already-merged retrieval and local-model lifecycle work for Issues #16–#18,
and resolves the remaining data-integrity problems reported in Issue #20:

- importing the same directory more than once creates duplicate container
  trees and document records;
- directory rescans can report a top-level failure after useful work has
  completed;
- directory-imported leaves do not retain their source path, so an individual
  file reindex can rebuild from a stored snapshot rather than the live file;
- base-wide background reindexing skips directory synchronization; and
- deleting a non-empty directory silently removes descendants and raw
  snapshots.

The related installation recovery documentation for Issue #22 is included as
a documentation-only item. No code is changed to work around an invalid DSH
profile workspace manifest because that parse error occurs before this plugin
is loaded.

## Compatibility contract

0.4.0 is a reliability release and a release-discipline milestone, not a
destructive data-format rewrite.

- A 0.3.9 data directory starts without a database migration, re-embedding, or
  automatic cleanup.
- Existing public fields and normal file, text, URL, search, and reindex
  workflows remain available.
- New result fields are additive and optional where an older caller may not
  know them.
- Existing duplicate directory trees are never merged or removed
  automatically. A new sync detects ambiguity and reports it explicitly.
- Server absolute paths can be shown in administrative document APIs and UI
  where the user already manages local paths, but are never emitted in
  model-facing search results or tool renderings.
- Deleting a non-empty directory becomes intentionally safer: callers must
  explicitly set `recursive: true`. This is an intentional safety change and
  is the only behavior that requires a caller decision.

## Alternatives considered

### A. Unified source-root synchronization engine — selected

One engine powers first import, repeated import, directory reindex, and
background base reindex. It works from a canonical source-root identity and
reports an itemized outcome. This eliminates divergent behavior between the
four entry points and makes it possible to test the lifecycle once.

### B. Patch only the current directory rescan

This could stop one duplicate path and avoid throwing after partial success,
but first import, individual reindex, and background reindex would remain
separate code paths. It would leave the central source-identity defect in
place and is not sufficient for a reliability release.

### C. Automatically merge historical duplicate trees

This would require choosing an owner for raw snapshots, manually organized
nodes, and potentially conflicting descendants. It risks user data loss, so
0.4.0 deliberately does not perform it.

## Architecture

### Canonical directory identity

A directory source is identified by:

```text
knowledgeBaseId + canonicalRealPath
```

`canonicalRealPath` is made absolute, resolved through `realpath`, and
normalized for separators. Windows comparisons are case-insensitive. The
value is retained in the existing optional `sourcePath` field rather than a
new schema table.

At import time the service locates top-level directory containers for the
same base and canonical path:

- zero candidates: create a root and perform initial synchronization;
- one candidate: reuse that root and perform synchronization;
- more than one candidate: return `ambiguous_source` with candidate document
  IDs. Do not select, merge, move, or delete a tree.

Importing the same canonical path under a different requested parent returns
`source_path_conflict`; it must never duplicate or move the established tree.

Legacy items gain source paths lazily during a successful sync. The service
does not infer an identity when multiple old roots could represent the same
directory.

### Unified synchronization flow

The service builds one disk inventory and one in-memory tree map for the
chosen source root. Within that root, an item is matched by its normalized
relative path and expected kind, never merely by a display name.

For each supported disk file or directory, the engine records exactly one of:

```ts
type DirectorySyncAction = 'created' | 'updated' | 'unchanged' | 'deleted' | 'failed'
```

Rules:

- A new item is created with `sourcePath`; files also persist their raw source
  snapshot.
- A byte-identical file is `unchanged`, with no parsing, chunking, or embedding
  work.
- A changed file refreshes its raw snapshot and is reindexed from its live
  path.
- An absent tracked item is removed only when it belongs to the synchronized
  source root.
- Per-item parse, read, or embedding failures are reported as `failed` and do
  not undo successful siblings.
- An unreadable root or invalid source is a root-level error before writes; the
  prior tree remains intact.

The engine returns:

```ts
interface DirectorySyncResult {
  sourceId: string
  status: 'synced' | 'unchanged' | 'partial'
  created: number
  updated: number
  unchanged: number
  deleted: number
  failed: number
  items: DirectorySyncItem[]
}
```

`partial` is a successful response with failures represented truthfully in the
result; it must not be turned into a generic HTTP 500 or `ok: false` after
other work succeeded.

### Reindexing

All directory entry points call the unified sync engine:

- a repeated directory import;
- a directory reindex requested by the user;
- batch reindex when it selects a directory root; and
- background reindex of a base.

The background job discovers only outermost directory roots, runs each once,
and skips descendants that the root sync already owns. Standalone path-backed
files are reread from `sourcePath`; uploaded files without a path retain their
snapshot-based behavior.

### Source visibility

Administrative `DocumentSummary` and `DocumentDetail` gain an optional,
read-only `sourcePath`. Directory-imported leaves receive it at initial import
and through later sync. Model-facing responses remain path-free.

Import and reindex responses keep existing fields while adding `sourceId`,
`mode: 'created' | 'synced'`, aggregate counters, and itemized results.

### Safe deletion

`GET /knowledge/documents/:id/delete-impact` calculates the selected root and
descendants before mutation, including directory, file, chunk, and raw-snapshot
counts.

For non-empty directory deletion:

- HTTP `DELETE` requires `?recursive=true`;
- batch deletion requires `recursive: true` in its body;
- `knowledge_delete_document` exposes an explicit `recursive` argument; and
- the UI fetches impact and displays a second confirmation.

Without confirmation the operation returns
`recursive_confirmation_required`, including delete-impact details, and makes
zero writes. Batch deletion preflights every selection before deleting any
item. Ordinary files and empty directories retain their one-step deletion
flow.

## Included 0.4.0 work

- Issue #16: report actual retrieval lanes and final score meaning.
- Issue #17: isolate local embedding in a recoverable child process with strict
  IPC, readiness verification, timeout recovery, and safe lifecycle handling.
- Issue #18: make local reranker readiness reflect successful ordinary
  inference rather than remaining stuck in validation.
- Issue #20: canonical directory sources, unified sync outcomes, live file
  reindexing, safe cascading deletion, and corresponding UI/tool/API changes.
- Issue #22: README installation recovery instructions, including the correct
  `esbuild` build permission and valid profile workspace recovery guidance.

## Validation and release gates

### Automated coverage

- Clean and dirty SQLite directory fixtures covering repeated imports,
  modification, addition, deletion, nested paths, same names in different
  roots, ambiguity, parent conflicts, partial errors, and unreadable roots.
- Live source-path reindex for directory leaves, snapshot fallback for uploads,
  and exactly-once directory processing in a base-wide job.
- Delete impact, recursive confirmation, batch atomic preflight, and UI/tool
  contracts.
- Existing Issue #16–#18 tests: retrieval lane truthfulness, strict embedding
  IPC, crash/timeout recovery, readiness transitions, and package inclusion.
- 0.3.9 data fixture starts without migration or re-embedding.

### Release verification

- `typecheck`, full Vitest suite, retrieval benchmark, build, package and
  release verification;
- Quality CI on Node 22.19, 24, and 26;
- native CI on Ubuntu, Windows, and macOS;
- packed DSH smoke on Ubuntu and Windows; and
- real local embedding and local rerank smoke on Ubuntu under Node 22.19, 24,
  and 26.

Only after all gates pass will the package version, changelog, generated `lib`,
release notes, and `v0.4.0` tag be prepared. GitHub Release and `npm publish`
require a final explicit maintainer confirmation and are not automatic.

## Non-goals

- No automatic deletion or consolidation of historical duplicate directory
  trees.
- No change to chunking, OCR, automatic-retrieval strategy, multi-space
  embedding semantics, or Issue #6 behavior.
- No external telemetry and no logs containing document bodies, queries, or
  credentials.
