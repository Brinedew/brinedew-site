// Compatibility shim only.
// The real public benchmark edge worker entrypoint is:
// `the-only-allowed-public-benchmark-edge-worker-that-must-not-touch-state.js`
export {
  default,
  handleBenchmarkRequestByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate,
} from "./the-only-allowed-public-benchmark-edge-worker-that-must-not-touch-state.js"
