import type { GameWorld, PlayerComp, Resources } from "../core/world"
import { showDamageAt } from "./combat"
import { recalcStats } from "./loot"

/** level → level+1 에 필요한 XP */
export function xpForLevel(level: number): number {
  return Math.floor(100 * Math.pow(level, 1.5))
}

const ATTACK_PER_LEVEL = 2
/** 레벨업 시 회복 비율. 전체 회복은 위기를 지운다. */
export const LEVEL_UP_HEAL_PCT = 0.4
const MAXHP_PER_LEVEL = 15

/**
 * 처치 시 회복 비율. v0에는 물약이 없어 이것이 유일한 지속력 수단이다.
 *
 * 0.08 이었는데 시나리오 하니스로 재 보니 **한 판의 총 회복량이 총 피해를 크게 넘었다**:
 * 적 15마리 × 8% = 최대 체력의 120%, 여기에 레벨업 전체 회복 2회가 더해져 약 400 HP.
 * 단독 플레이 실측 피해는 242 였다. 맞으면서도 체력이 차오르니 위험이 성립하지 않는다.
 */
export const LIFE_ON_KILL_PCT = 0.03

export function lifeOnKill(maxHp: number, kills: number, flatPerKill = 0): number {
  return (Math.round(maxHp * LIFE_ON_KILL_PCT) + Math.max(0, flatPerKill)) * kills
}

export function applyXp(player: PlayerComp, amount: number): { levelsGained: number } {
  player.xp += amount
  let levelsGained = 0
  while (player.xp >= xpForLevel(player.level)) {
    player.xp -= xpForLevel(player.level)
    player.level += 1
    player.baseAttack += ATTACK_PER_LEVEL
    player.baseMaxHp += MAXHP_PER_LEVEL
    levelsGained += 1
  }
  return { levelsGained }
}

export function progressionSystem(world: GameWorld, res: Resources, dt: number): void {
  void dt
  const playerEntity = world.with("player", "health").entities[0]
  if (!playerEntity?.player) return
  const pc = playerEntity.player

  let gained = 0
  let kills = 0
  for (const e of [...world.with("dead", "xpReward")]) {
    gained += e.xpReward
    kills += 1
    world.removeComponent(e, "xpReward")
  }

  if (kills > 0 && !playerEntity.dead) {
    const heal = lifeOnKill(playerEntity.health.max, kills, pc.lifeOnKill)
    const before = playerEntity.health.current
    playerEntity.health.current = Math.min(playerEntity.health.max, before + heal)
    const actual = playerEntity.health.current - before
    if (actual > 0 && playerEntity.transform) {
      showDamageAt(res, playerEntity.transform.position, `+${actual}`, "heal")
    }
  }

  if (gained > 0) {
    const { levelsGained } = applyXp(pc, gained)
    if (levelsGained > 0) {
      recalcStats(playerEntity)
      // 레벨업 회복. 예전엔 전체 회복이었는데, 그러면 레벨업 한 번이 위기를 통째로 지운다.
      // 보상은 남기되 "아슬아슬했다" 는 감각이 사라지지 않을 만큼만 준다.
      playerEntity.health.current = Math.min(
        playerEntity.health.max,
        playerEntity.health.current + Math.round(playerEntity.health.max * LEVEL_UP_HEAL_PCT),
      )
      res.hud.flashLevelUp()
    }
  }

  res.hud.setXp(pc.xp, xpForLevel(pc.level), pc.level)
}
