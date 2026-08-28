/**
 * Hitstop is a gameplay-time scale, not a render-loop pause.
 * The renderer keeps presenting frames while simulation time briefly slows,
 * so impact VFX, audio, camera feedback, and HUD pulses remain visible.
 */
export interface HitstopState {
  remaining: number
  scale: number
}

export const HITSTOP = {
  defaultScale: 0.05 as number,
  lightHitMs: 50,
  playerHitMs: 70,
  enemyDefeatedMs: 90,
  bossDefeatedMs: 90,
} as const

export function createHitstop(): HitstopState {
  return { remaining: 0, scale: 1 }
}

/** Add a hitstop request. Overlapping requests keep the longer duration. */
export function requestHitstop(
  state: HitstopState,
  durationMs: number,
  scale = HITSTOP.defaultScale,
): void {
  const duration = Math.max(0, durationMs) / 1000
  if (duration <= 0) return

  const clampedScale = Math.min(1, Math.max(0.01, scale))
  state.remaining = Math.max(state.remaining, duration)
  state.scale = Math.min(state.scale, clampedScale)
}

/** Advance using real time and return the simulation delta. */
export function advanceHitstop(state: HitstopState, realDelta: number): number {
  const delta = Math.max(0, realDelta)
  if (state.remaining <= 0) {
    state.scale = 1
    return delta
  }

  const slowedDelta = Math.min(delta, state.remaining)
  const normalDelta = delta - slowedDelta
  const simulationDelta = slowedDelta * state.scale + normalDelta
  state.remaining = Math.max(0, state.remaining - delta)
  if (state.remaining === 0) state.scale = 1
  return simulationDelta
}

export function isHitstopActive(state: HitstopState): boolean {
  return state.remaining > 0
}
