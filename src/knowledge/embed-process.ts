/**
 * Child-process entrypoint for isolated local embedding inference.
 *
 * The implementation lives beside the former worker implementation while the
 * build emits this stable process-only runtime artifact. Keeping this tiny
 * entrypoint makes the packaging contract explicit and prevents host code
 * from ever importing the transformers/ONNX runtime directly.
 */
import './embed-worker.js'
