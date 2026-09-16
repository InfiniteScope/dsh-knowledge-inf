import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Pinned explicitly, and the reason matters: this suite loads native addons
    // (mupdf, pdfjs-dist, onnxruntime via the OCR worker, @napi-rs/canvas) and the
    // `threads` pool was measured to crash the whole run with an access violation
    // — 2 of 4 full-suite runs, and 2 of 6 runs of tests/ocr.spec.ts alone — while
    // the `forks` pool passed 6 of 6. Forks also isolate each test file in its own
    // process, which is what CI has always run; pinning it keeps a local run and a
    // CI run testing the same thing.
    pool: 'forks',
    // Off by default, and the leak is real: tests/domain-store.spec.ts stubs
    // DSH_HOME in a dozen tests with no afterEach, so after the first stub every
    // later test in the file inherited a temp directory the previous test had
    // already deleted. Restore per test instead of per file.
    unstubEnvs: true,
  },
})
