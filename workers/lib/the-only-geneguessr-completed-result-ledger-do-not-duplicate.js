// THE ONLY durable ledger of completed GeneGuessr rounds. The active game state
// changes at midnight; these tiny results stay in the existing player session
// until the account's stats row has accepted each date.
function completedDailyResult(state) {
  if (!state || state.practiceMode || !/^\d{4}-\d{2}-\d{2}$/.test(state.date || "")) return null
  const guesses = Array.isArray(state.guesses) ? state.guesses : []
  const maxGuesses = Number.isInteger(state.maxGuesses) ? state.maxGuesses : 10
  if (!state.won && guesses.length < maxGuesses) return null
  return { date: state.date, won: Boolean(state.won) }
}

export async function storeGameState(storage, state) {
  const result = completedDailyResult(state)
  if (!result) {
    await storage.put("game_state", state)
    return
  }
  await storage.transaction(async (tx) => {
    const pending = (await tx.get("pending_results")) || []
    const recordedThrough = (await tx.get("stats_recorded_through")) || ""
    if (result.date > recordedThrough && !pending.some((entry) => entry.date === result.date)) {
      await tx.put("pending_results", [...pending, result])
    }
    await tx.put("game_state", state)
  })
}

export async function getPendingResults(storage) {
  return (await storage.get("pending_results")) || []
}

export async function ackCompletedResult(storage, date) {
  await storage.transaction(async (tx) => {
    const pending = (await tx.get("pending_results")) || []
    await tx.put(
      "pending_results",
      pending.filter((entry) => entry.date !== date),
    )
    const recordedThrough = (await tx.get("stats_recorded_through")) || ""
    if (date > recordedThrough) await tx.put("stats_recorded_through", date)
  })
}
