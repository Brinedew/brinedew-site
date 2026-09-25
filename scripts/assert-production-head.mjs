import { enforceProductionHead } from "./lib/production-head-gate.mjs"

try {
  const outcome = await enforceProductionHead({ env: process.env })
  if (outcome === "current") {
    console.log(`[production-source] Current main verified: ${process.env.GITHUB_SHA}`)
  } else {
    // Cancellation is asynchronous. Never exit 0 here: the next step would
    // start deploying a superseded commit. Wait to be cancelled; if that
    // somehow doesn't happen, fail red.
    console.log(
      "::notice title=Superseded by a newer push::main has moved on; a newer run deploys it. This run is cancelling itself.",
    )
    await new Promise((resolve) => setTimeout(resolve, 120_000))
    throw new Error("Superseded production run was not cancelled within 120 s")
  }
} catch (error) {
  console.error(`[production-source] ${error.message}`)
  process.exit(1)
}
