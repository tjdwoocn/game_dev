import type { BreakableComp, Entity, GameWorld, Resources } from "../core/world"

export const BREAK = {
  focusMultiplier: 1.5,
  stunDuration: 3,
} as const

export function beginBreakWindow(breakable: BreakableComp, now: number, duration: number): void {
  if (breakable.brokenUntil > now) return
  if (breakable.current <= 0) breakable.current = breakable.max
  breakable.exposedUntil = Math.max(breakable.exposedUntil, now + duration)
}

export function isBreakExposed(breakable: BreakableComp, now: number): boolean {
  return breakable.exposedUntil > now && breakable.brokenUntil <= now
}

export function isFocused(breakable: BreakableComp | undefined, now: number): boolean {
  return !!breakable && breakable.vulnerabilityUntil > now
}

export function applyBreakDamage(
  breakable: BreakableComp,
  amount: number,
  now: number,
): { applied: boolean; broke: boolean; remaining: number } {
  if (amount <= 0 || !isBreakExposed(breakable, now)) {
    return { applied: false, broke: false, remaining: breakable.current }
  }
  breakable.current = Math.max(0, breakable.current - amount)
  if (breakable.current > 0) return { applied: true, broke: false, remaining: breakable.current }
  breakable.brokenUntil = now + BREAK.stunDuration
  breakable.vulnerabilityUntil = breakable.brokenUntil
  breakable.exposedUntil = now
  return { applied: true, broke: true, remaining: 0 }
}

export function breakSystem(world: GameWorld, res: Resources, dt: number): void {
  void dt
  const now = res.time.now
  for (const e of world.with("breakable")) {
    const b = e.breakable
    if (b.brokenUntil > 0 && now >= b.brokenUntil) {
      b.brokenUntil = 0
      b.vulnerabilityUntil = 0
      b.current = b.max
    }
    if (e.stunned && now >= e.stunned.until) world.removeComponent(e, "stunned")
  }
}

export function triggerBreak(world: GameWorld, res: Resources, target: Entity): void {
  if (!target.stunned) world.addComponent(target, "stunned", { until: res.time.now + BREAK.stunDuration })
  else target.stunned.until = res.time.now + BREAK.stunDuration
  if (target.moveTarget) world.removeComponent(target, "moveTarget")
  if (target.path) world.removeComponent(target, "path")
  if (target.attack) target.attack.readyAt = res.time.now + BREAK.stunDuration
}
