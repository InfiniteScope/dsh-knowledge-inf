# README presentation redesign

## Objective

Improve the material below the existing hero image in `README.md` and keep
`README.en.md` structurally equivalent. The redesign should help a first-time
visitor understand the plugin, install it, and find the relevant technical
details without removing important compatibility, configuration, security, or
licensing information.

The hero area above and including the existing screenshot remains unchanged.
No emoji will be added anywhere in either README.

## Audience and reading order

The primary audience is a DSH user evaluating or installing the plugin. The
secondary audience is a contributor or advanced operator looking for runtime,
configuration, architecture, or verification details.

The content below the screenshot will follow this order:

1. A concise value proposition and six-category capability overview.
2. A quick-start path containing the required pnpm build allowlist, install
   command, restart instruction, and first-use steps.
3. Grouped feature sections with one capability per bullet.
4. A compact v0.3.9 highlights section linked to the full release notes.
5. A short ingestion-to-evidence workflow explanation.
6. A technical retrieval deep dive covering query planning, hybrid fusion,
   reranking, evidence composition, automatic retrieval, and failure semantics.
7. An accurate runtime architecture and engineering-guarantees description.
8. A dated, source-linked comparison with adjacent DSH knowledge and RAG
   projects. The comparison describes project scope and documented design
   choices rather than declaring winners.
9. Compatibility, configuration, evaluation, usage, development, verification,
   limitations, security, and licensing references.

This ordering keeps the normal user path above implementation detail while
preserving the README as a useful technical reference.

## Presentation rules

- Replace the current oversized feature bullets with short, independently
  scannable statements.
- Use Markdown tables only for compact comparisons or exact mappings. Do not
  put paragraph-length prose into table cells.
- Use `<details>` sections for long reference material such as supported file
  formats, advanced local-model behavior, and the full configuration table.
- Keep warnings immediately beside the action they affect. In particular, the
  pnpm `allowBuilds` requirement must appear before the installation command.
- Avoid marketing superlatives and unverified performance claims.
- Keep commands copyable and avoid hiding required steps inside prose.
- Preserve all material operational facts, defaults, platform restrictions,
  security disclosures, and AGPL attribution.
- Keep algorithmic details concrete: name the retrieval stages, show the RRF
  formula and token budgets, and document the fallback contract for each
  failure class.
- Any ecosystem comparison must cite the compared repository, carry an
  explicit review date, and distinguish "not documented or found" from
  "unsupported". Avoid winner/loser language and checkmark scorecards.

## Proposed Chinese README structure

The content after the screenshot in `README.md` will be reorganized as:

1. `为什么选择 dsh-knowledge`
   - A brief description.
   - A two-column capability table covering document ingestion, retrieval,
     local models, OCR, evidence windows, and management UI.
2. `快速开始`
   - Prerequisites and the pnpm build allowlist.
   - npm installation command.
   - Restart and first-use instructions.
   - A link to source/tarball installation alternatives.
3. `核心能力`
   - Document and source management.
   - Retrieval and evidence composition.
   - Parsing, OCR, and optional MinerU.
   - Local/remote embedding and reranking.
   - Model tools and management interface.
   - Persistent storage and index management.
4. `v0.3.9 更新重点`
   - A compact summary of local-path import, durable source tracking, safe
     reindexing, Ollama behavior, and UI/localization improvements.
   - Links to the GitHub Release and changelog instead of repeating the entire
     release body.
5. `工作流程`
   - A concise ordered flow from import through parsing, chunking, embedding,
     retrieval, optional rerank, `ContextWindow`, and anchored continuation.
6. `技术设计：从查询到可续读证据`
   - Current-turn-first query planning and bounded history enrichment.
   - BM25/vector lanes, weighted RRF, optional MMR, and rerank-once behavior.
   - Dynamic `ContextWindow`, exact-identifier checks, and fixed token budgets.
   - Explicit search versus latency-bounded proactive retrieval.
7. `工程可靠性`
   - Fail-closed scope, fail-soft ranking, model readiness, process isolation,
     source replacement safety, and package/CI gates.
8. `架构`
   - Host services and client bundle.
   - `embed-worker` and `ocr-worker` identified as worker threads.
   - `rerank-process.mjs` identified as an independent child process.
9. `在 DSH 知识库与 RAG 生态中的定位`
   - A neutral comparison of the public READMEs of directly adjacent projects.
   - A concise statement of the end-to-end capability combination that was not
     documented by any single reviewed peer at the review date.
   - Recognition of areas where focused projects intentionally make different
     tradeoffs, such as session memory, revision history, external RAGFlow, or
     an offline paper index.
10. Reference material
   - Compatibility.
   - Configuration, with the full field table in a disclosure block.
   - Retrieval evaluation.
   - Usage, development, verification, and known limitations.
8. `安全` and `许可`
   - Link to `SECURITY.md` and the private vulnerability-reporting route.
   - Preserve AGPL explanation and acknowledgements.

## English synchronization

`README.en.md` will use the same hierarchy, commands, defaults, warnings, and
links. English copy will be written idiomatically rather than translated word
for word. Neither README will contain material capabilities absent from the
other, although sentence length may differ for readability.

## Content preservation and correction

The redesign must preserve:

- Supported import formats and size/concurrency limits.
- Local embedding, local rerank, OCR, MinerU, and Hugging Face endpoint rules.
- Node, pnpm, platform, and Intel Mac constraints.
- Every documented configuration field and default.
- The 14 tool names and their security boundaries.
- Benchmark caveats and verification commands.
- Storage architecture, migration behavior, and API-key storage warning.
- Known limitations, licensing rationale, and project acknowledgements.

The architecture section will correct the current incomplete wording that
describes only two inference worker threads. It will distinguish long-lived
embedding/OCR worker threads from the isolated local-rerank child process.

## Validation

After implementation:

- Compare headings and key facts across both language versions.
- Search for emoji additions and stale package-version examples.
- Verify every relative repository link and every external project/security
  link used by the READMEs.
- Verify fenced code blocks and HTML disclosure tags are balanced.
- Run the repository's documentation or release verification command when it
  covers README package examples.
- Review the rendered Markdown structure on GitHub or an equivalent local
  preview before committing the implementation.

## Non-goals

- Changing the hero image, badges, project name, or introductory content above
  the image.
- Changing plugin behavior, source code, package metadata, or release version.
- Creating a separate documentation website.
- Removing advanced reference information from the repository.
- Adding emoji, decorative screenshots, or unverified claims.
