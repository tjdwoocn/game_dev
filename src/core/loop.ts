export const STEP = 1 / 60
const MAX_STEPS = 5

/** 누적 경과 시간에서 실행할 고정 스텝 수와 잔여 시간을 계산한다. */
export function stepAccumulator(acc: number): { steps: number; remainder: number } {
  let steps = Math.floor(acc / STEP)
  if (steps > MAX_STEPS) {
    return { steps: MAX_STEPS, remainder: 0 }
  }
  return { steps, remainder: acc - steps * STEP }
}

export function createLoop(logic: (dt: number) => void, render: () => void) {
  let acc = 0
  let last = performance.now()
  const frame = () => {
    const now = performance.now()
    acc += Math.min((now - last) / 1000, 0.25)
    last = now
    const { steps, remainder } = stepAccumulator(acc)
    for (let i = 0; i < steps; i++) logic(STEP)
    acc = remainder
    render()
    requestAnimationFrame(frame)
  }
  return { start: () => requestAnimationFrame(frame) }
}
