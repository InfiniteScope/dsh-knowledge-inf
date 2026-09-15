/** Dedicated local cross-encoder process. Never imported by the host. */

import { readdir, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { applyGlobalProxy, NETWORK_HINT } from './net.js'
import { CrossEncoderResponseError, scoreCrossEncoder } from './rerank-adapter.js'
import {
  LOCAL_RERANK_PROTOCOL_VERSION,
  type LocalRerankFailureResponse,
  type LocalRerankProgressEvent,
  type LocalRerankRequest,
  type LocalRerankSuccessResponse,
} from './rerank-protocol.js'

applyGlobalProxy()

interface TransformersModule {
  env: { allowLocalModels: boolean; allowRemoteModels?: boolean; cacheDir?: string; remoteHost?: string }
  AutoModel: {
    from_pretrained(modelId: string, options?: Record<string, unknown>): Promise<{
      (inputs: Record<string, unknown>): Promise<{ logits?: { data?: ArrayLike<number>; dims?: number[] } }>
      dispose?(): Promise<void>
    }>
  }
  AutoTokenizer: {
    from_pretrained(modelId: string, options?: Record<string, unknown>): Promise<
      (texts: string[], options: { text_pair: string[]; padding: true; truncation: true }) => Promise<Record<string, unknown>>
    >
  }
}

interface Runner {
  modelId: string
  rerank(query: string, texts: readonly string[]): Promise<number[]>
  dispose(): Promise<void>
  batchSize(): number
}

let transformers: TransformersModule | null = null
let activeRunner: Runner | null = null
let operationChain: Promise<unknown> = Promise.resolve()

function post(message: LocalRerankSuccessResponse | LocalRerankFailureResponse | LocalRerankProgressEvent): void {
  if (typeof process.send === 'function') process.send(message)
}

function progress(modelId: string, status: LocalRerankProgressEvent['status'], value: number, message = ''): void {
  post({
    protocolVersion: LOCAL_RERANK_PROTOCOL_VERSION,
    event: 'progress',
    modelId,
    status,
    progress: value,
    message,
  })
}

async function loadTransformers(): Promise<TransformersModule> {
  if (transformers !== null) return transformers
  transformers = (await import('@huggingface/transformers')) as unknown as TransformersModule
  return transformers
}

/** Weights are complete only when the downloader reported an expected size for
 *  the weights file and the file on disk matches it. The previous test — "any
 *  non-empty `.onnx` exists" — accepted a truncated file, which then skipped the
 *  download branch forever while the local load kept failing: a permanent,
 *  self-concealing failure the user could only clear by hand. */
async function weightsAreComplete(modelId: string, cacheDir: string, expected: ReadonlyMap<string, number>): Promise<boolean> {
  try {
    const names = await readdir(join(cacheDir, modelId, 'onnx'))
    for (const name of names) {
      if (!name.endsWith('.onnx')) continue
      const info = await stat(join(cacheDir, modelId, 'onnx', name))
      if (!info.isFile() || info.size <= 0) continue
      const total = expected.get(name)
      // Without a recorded total the file can only be judged non-empty, which is
      // exactly the case that needs the quarantine path below.
      if (total === undefined || total <= 0 || info.size === total) return true
    }
  } catch {
    return false
  }
  return false
}

/** Drop a model directory whose weights cannot be loaded, so the next attempt
 *  downloads again instead of failing forever against a corrupt cache. */
async function quarantineModel(modelId: string, cacheDir: string): Promise<void> {
  await rm(join(cacheDir, modelId), { recursive: true, force: true }).catch(() => {})
}

function applyEndpoint(tf: TransformersModule, endpoint: string | undefined): void {
  if (endpoint !== undefined && endpoint.trim() !== '') {
    tf.env.remoteHost = endpoint.trim().replace(/\/+$/, '')
  }
}

async function disposeRunner(): Promise<void> {
  const runner = activeRunner
  activeRunner = null
  await runner?.dispose().catch(() => {})
}

async function createRunner(request: LocalRerankRequest): Promise<Runner> {
  const tf = await loadTransformers()
  applyEndpoint(tf, request.hfEndpoint)
  tf.env.cacheDir = request.cacheDir
  tf.env.allowLocalModels = true

  // Expected byte size per weights file, straight from the downloader's own
  // progress events — no extra registry call, and it is what lets a truncated
  // file be told apart from a complete one.
  const expectedSizes = new Map<string, number>()
  if (!(await weightsAreComplete(request.modelId, request.cacheDir, expectedSizes))) {
    tf.env.allowRemoteModels = true
    progress(request.modelId, 'downloading', 0)
    let lastProgressAt = 0
    const progressCallback = (info: { status?: string; progress?: number; file?: string; loaded?: number; total?: number }): void => {
      if (typeof info.file === 'string' && typeof info.total === 'number' && info.total > 0) {
        expectedSizes.set(basename(info.file), info.total)
      }
      if (info.status !== 'progress' || typeof info.progress !== 'number') return
      const now = Date.now()
      if (now - lastProgressAt < 250) return
      lastProgressAt = now
      progress(request.modelId, 'downloading', info.progress)
    }
    let downloadedModel: Awaited<ReturnType<TransformersModule['AutoModel']['from_pretrained']>> | undefined
    try {
      downloadedModel = await tf.AutoModel.from_pretrained(request.modelId, {
        dtype: 'q8',
        progress_callback: progressCallback,
        trust_remote_code: false,
      })
      await tf.AutoTokenizer.from_pretrained(request.modelId, {
        progress_callback: progressCallback,
        trust_remote_code: false,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      progress(request.modelId, 'error', 0, `${message} · ${NETWORK_HINT}`)
      // A failed transfer must not leave a half-written cache that the next run
      // would accept as downloaded.
      await quarantineModel(request.modelId, request.cacheDir)
      throw error
    } finally {
      await downloadedModel?.dispose?.().catch(() => {})
    }
    if (!(await weightsAreComplete(request.modelId, request.cacheDir, expectedSizes))) {
      await quarantineModel(request.modelId, request.cacheDir)
      const message = 'local rerank weights are incomplete after download (the transfer was truncated); the partial cache was removed, retry the download'
      progress(request.modelId, 'error', 0, `${message} · ${NETWORK_HINT}`)
      throw new Error(message)
    }
  }

  progress(request.modelId, 'validating', 100)
  tf.env.allowRemoteModels = false
  const localPath = join(request.cacheDir, request.modelId)
  let model: Awaited<ReturnType<TransformersModule['AutoModel']['from_pretrained']>>
  let tokenizer: Awaited<ReturnType<TransformersModule['AutoTokenizer']['from_pretrained']>>
  try {
    model = await tf.AutoModel.from_pretrained(localPath, { dtype: 'q8', local_files_only: true, trust_remote_code: false })
    tokenizer = await tf.AutoTokenizer.from_pretrained(localPath, { local_files_only: true, trust_remote_code: false })
  } catch (error) {
    // A cache that exists but cannot be loaded is worthless and was previously
    // permanent: `hasOnnxWeights` kept reporting "downloaded" while every load
    // failed. Discard it so the next attempt re-downloads.
    await quarantineModel(request.modelId, request.cacheDir)
    const detail = error instanceof Error ? error.message : String(error)
    const message = `local rerank model could not be loaded from the cache (${detail}); the cache was removed, retry to download it again`
    progress(request.modelId, 'error', 0, message)
    throw new Error(message)
  }
  let safeBatchSize = 16
  return {
    modelId: request.modelId,
    async rerank(query, texts) {
      const result = await scoreCrossEncoder(tokenizer, model, query, texts, safeBatchSize)
      safeBatchSize = result.batchSize
      return result.scores
    },
    async dispose() { await model.dispose?.() },
    batchSize: () => safeBatchSize,
  }
}

async function ensureRunner(request: LocalRerankRequest): Promise<Runner> {
  if (activeRunner?.modelId === request.modelId) return activeRunner
  await disposeRunner()
  activeRunner = await createRunner(request)
  return activeRunner
}

async function selfTest(request: LocalRerankRequest): Promise<{ healthy: true; latencyMs: number; scores: number[]; batchSize: number }> {
  const runner = await ensureRunner(request)
  const startedAt = Date.now()
  const scores = await runner.rerank('如何申请费用报销？', [
    '费用报销需要提交发票并经过负责人审批。',
    '今天的天气晴朗，适合户外散步。',
  ])
  if (scores.length !== 2 || scores.some(score => !Number.isFinite(score))) {
    throw new CrossEncoderResponseError('rerank self-test returned invalid scores')
  }
  if (!(scores[0]! > scores[1]!) || Math.abs(scores[0]! - scores[1]!) < 1e-6) {
    throw new CrossEncoderResponseError('rerank self-test did not distinguish relevant and irrelevant text')
  }
  const health = { healthy: true as const, latencyMs: Date.now() - startedAt, scores, batchSize: runner.batchSize() }
  progress(request.modelId, 'ready', 100)
  return health
}

async function handle(request: LocalRerankRequest): Promise<LocalRerankSuccessResponse> {
  if (request.protocolVersion !== LOCAL_RERANK_PROTOCOL_VERSION) throw new CrossEncoderResponseError('unsupported local rerank protocol version')
  if (request.operation === 'shutdown') {
    await disposeRunner()
    return { protocolVersion: LOCAL_RERANK_PROTOCOL_VERSION, id: request.id, operation: 'shutdown', ok: true }
  }
  if (request.operation === 'dispose') {
    await disposeRunner()
    return { protocolVersion: LOCAL_RERANK_PROTOCOL_VERSION, id: request.id, operation: 'dispose', ok: true }
  }
  if (request.operation === 'load') {
    await ensureRunner(request)
    // `createRunner()` reports validating while it opens the local ONNX
    // session. A plain load used by a normal search never enters selfTest(),
    // so it must publish its terminal state here as well. Otherwise the main
    // process permanently gates the next query as `model_checking` (#18).
    progress(request.modelId, 'ready', 100)
    return { protocolVersion: LOCAL_RERANK_PROTOCOL_VERSION, id: request.id, operation: 'load', ok: true }
  }
  if (request.operation === 'self_test') {
    return { protocolVersion: LOCAL_RERANK_PROTOCOL_VERSION, id: request.id, operation: 'self_test', ok: true, health: await selfTest(request) }
  }
  const runner = await ensureRunner(request)
  const scores = await runner.rerank(request.query, request.texts)
  // A rerank can be the first operation after an idle child restart. Mark it
  // ready only after scoring completed, so readiness reflects a usable model
  // rather than a merely spawned process.
  progress(request.modelId, 'ready', 100)
  return { protocolVersion: LOCAL_RERANK_PROTOCOL_VERSION, id: request.id, operation: 'rerank', ok: true, scores }
}

function failure(request: LocalRerankRequest, error: unknown): LocalRerankFailureResponse {
  const code = error instanceof CrossEncoderResponseError ? 'invalid_response' : 'runtime_error'
  return {
    protocolVersion: LOCAL_RERANK_PROTOCOL_VERSION,
    id: request.id,
    operation: request.operation,
    ok: false,
    error: { code, message: error instanceof Error ? error.message : String(error), retryable: code !== 'invalid_response' },
  }
}

process.on('message', (message: LocalRerankRequest) => {
  operationChain = operationChain
    .then(async () => {
      try {
        const response = await handle(message)
        post(response)
        if (message.operation === 'shutdown') process.exit(0)
      } catch (error) {
        post(failure(message, error))
      }
    })
    .catch(() => {})
})

process.on('disconnect', () => {
  void disposeRunner().finally(() => process.exit(0))
})
