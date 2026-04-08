// Compatibility shim only.
// The real public edge worker entrypoint is:
// `the-only-allowed-public-edge-worker-that-must-not-touch-state.js`
// Keep this file tiny so nobody mistakes the generic name for the place to add
// new stateful features.
export {
  default,
  handleRequestByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate,
} from "./the-only-allowed-public-edge-worker-that-must-not-touch-state.js"
