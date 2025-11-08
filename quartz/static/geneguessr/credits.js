;(function (global) {
  const STORAGE_KEY = "geneguessr_credits_v1"
  const DEFAULT_CREDITS = 1
  const DEFAULT_COST = 1

  function readState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) {
        return { credits: DEFAULT_CREDITS, rounds: {} }
      }
      const parsed = JSON.parse(raw)
      return {
        credits: typeof parsed.credits === "number" ? parsed.credits : DEFAULT_CREDITS,
        rounds: parsed.rounds && typeof parsed.rounds === "object" ? parsed.rounds : {},
      }
    } catch (err) {
      console.warn("GeneGuessrCredits: unable to read state", err)
      return { credits: DEFAULT_CREDITS, rounds: {} }
    }
  }

  function writeState(next) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch (err) {
      console.warn("GeneGuessrCredits: unable to persist state", err)
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
    if (typeof state.credits !== "number") {
      state.credits = DEFAULT_CREDITS
    }
    writeState(state)
  }

  function getCredits() {
    const state = readState()
    return state.credits ?? DEFAULT_CREDITS
  }

  function canAfford(cost = DEFAULT_COST) {
    const state = readState()
    return (state.credits ?? 0) >= cost
  }

  function earnCredits(amount = 1) {
    if (!amount) return getCredits()
    const state = readState()
    state.credits = Math.max(0, (state.credits ?? 0) + amount)
    writeState(state)
    return state.credits
  }

  function spendCredits(cost = DEFAULT_COST) {
    const state = readState()
    if ((state.credits ?? 0) < cost) {
      return { success: false, credits: state.credits ?? 0 }
    }
    state.credits = Math.max(0, (state.credits ?? 0) - cost)
    writeState(state)
    return { success: true, credits: state.credits }
  }

  function isHintRevealed(roundId, hintId) {
    if (!roundId || !hintId) return true
    const state = readState()
    const round = state.rounds?.[roundId]
    return Boolean(round && round.reveals && round.reveals[hintId])
  }

  function revealHint(roundId, hintId, cost = DEFAULT_COST) {
    if (!roundId || !hintId) {
      return { success: true, credits: getCredits() }
    }
    const state = readState()
    ensureRound(state, roundId)
    if ((state.credits ?? 0) < cost) {
      return { success: false, credits: state.credits ?? 0 }
    }
    state.credits = Math.max(0, (state.credits ?? 0) - cost)
    state.rounds[roundId].reveals = state.rounds[roundId].reveals || {}
    state.rounds[roundId].reveals[hintId] = true
    writeState(state)
    return { success: true, credits: state.credits }
  }

  function resetRound(roundId) {
    if (!roundId) return
    const state = readState()
    if (state.rounds && state.rounds[roundId]) {
      state.rounds[roundId].reveals = {}
      writeState(state)
    }
  }

  global.GeneGuessrCredits = {
    initRound,
    getCredits,
    canAfford,
    earnCredits,
    spendCredits,
    isHintRevealed,
    revealHint,
    resetRound,
    DEFAULT_COST,
  }
})(window)
