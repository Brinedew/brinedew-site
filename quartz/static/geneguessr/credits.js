;(function (global) {
  const STORAGE_KEY = "geneguessr_hints_v1"
  const DEFAULT_HINTS = 1
  const DEFAULT_COST = 1

  function readState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) {
        return { hints: DEFAULT_HINTS, rounds: {} }
      }
      const parsed = JSON.parse(raw)
      return {
        hints: typeof parsed.hints === "number" ? parsed.hints : DEFAULT_HINTS,
        rounds: parsed.rounds && typeof parsed.rounds === "object" ? parsed.rounds : {},
      }
    } catch (err) {
      console.warn("GeneGuessrHints: unable to read state", err)
      return { hints: DEFAULT_HINTS, rounds: {} }
    }
  }

  function writeState(next) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch (err) {
      console.warn("GeneGuessrHints: unable to persist state", err)
    }
  }

  function ensureRound(state, roundId) {
    if (!roundId) {
      return state.rounds
    }
    if (!state.rounds[roundId]) {
      state.rounds[roundId] = { reveals: {} }
    }
    return state.rounds
  }

  function initRound(roundId) {
    if (!roundId) return
    const state = readState()
    ensureRound(state, roundId)
    if (typeof state.hints !== "number") {
      state.hints = DEFAULT_HINTS
    }
    writeState(state)
  }

  function getHints() {
    const state = readState()
    return state.hints ?? DEFAULT_HINTS
  }

  function canAfford(cost = DEFAULT_COST) {
    const state = readState()
    return (state.hints ?? 0) >= cost
  }

  function earnHints(amount = 1) {
    if (!amount) return getHints()
    const state = readState()
    state.hints = Math.max(0, (state.hints ?? 0) + amount)
    writeState(state)
    return state.hints
  }

  function spendHints(cost = DEFAULT_COST) {
    const state = readState()
    if ((state.hints ?? 0) < cost) {
      return { success: false, hints: state.hints ?? 0 }
    }
    state.hints = Math.max(0, (state.hints ?? 0) - cost)
    writeState(state)
    return { success: true, hints: state.hints }
  }

  function isHintRevealed(roundId, hintId) {
    if (!roundId || !hintId) return true
    const state = readState()
    const round = state.rounds?.[roundId]
    return Boolean(round && round.reveals && round.reveals[hintId])
  }

  function revealHint(roundId, hintId, cost = DEFAULT_COST) {
    if (!roundId || !hintId) {
      return { success: true, hints: getHints() }
    }
    const state = readState()
    ensureRound(state, roundId)
    if ((state.hints ?? 0) < cost) {
      return { success: false, hints: state.hints ?? 0 }
    }
    state.hints = Math.max(0, (state.hints ?? 0) - cost)
    state.rounds[roundId].reveals = state.rounds[roundId].reveals || {}
    state.rounds[roundId].reveals[hintId] = true
    writeState(state)
    return { success: true, hints: state.hints }
  }

  function resetRound(roundId) {
    if (!roundId) return
    const state = readState()
    if (state.rounds && state.rounds[roundId]) {
      state.rounds[roundId].reveals = {}
      writeState(state)
    }
  }

  global.GeneGuessrHints = {
    initRound,
    getHints,
    canAfford,
    earnHints,
    spendHints,
    isHintRevealed,
    revealHint,
    resetRound,
    DEFAULT_COST,
  }
})(window)
