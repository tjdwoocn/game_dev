import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { ELITE_MODIFIERS, ENEMY_DEFS, spawnEnemy } from "../src/content/enemies"
import { createWorld, type Resources } from "../src/core/world"
import { createGameplayEventBuffer } from "../src/core/events"
import { createHitstop } from "../src/core/hitstop"

function createResources(): Resources {
  return {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(45, 1, 0.1, 100),
    renderer: null as unknown as THREE.WebGLRenderer,
    input: {
      clicks: [], dashQueued: false, skillQueued: null,
      pointer: { ndcX: 0, ndcY: 0 }, toggleInventory: false,
      toggleMap: false, toggleStats: false, toggleSkills: false,
      zoomDelta: 0, rotateCamera: 0, pitchCamera: 0, returnTownQueued: false,
      interactQueued: false, held: new Set<string>(),
    },
    time: { now: 0, realNow: 0 },
    hitstop: createHitstop(),
    rng: () => 0.5,
    map: undefined as never,
    zoneId: "mine",
    hud: undefined as never,
    flags: { bossDefeated: false },
    events: createGameplayEventBuffer(),
  }
}

describe("정예 스폰 수식어", () => {
  it("기존 종류를 유지하면서 HP·피해·쿨다운·XP를 한 번만 강화한다", () => {
    const world = createWorld()
    const normal = spawnEnemy(world, "charger", 0, 0)
    const elite = spawnEnemy(world, "charger", 4, 0, true)
    const def = ENEMY_DEFS.charger

    expect(elite.enemy?.kind).toBe("charger")
    expect(elite.enemy?.isElite).toBe(true)
    expect(elite.health?.max).toBe(Math.round(def.hp * ELITE_MODIFIERS.hpMultiplier))
    expect(elite.attack?.damage).toBe(def.damage * ELITE_MODIFIERS.damageMultiplier)
    expect(elite.attack?.cooldown).toBe(def.attackCooldown * ELITE_MODIFIERS.attackCooldownMultiplier)
    expect(elite.xpReward).toBe(Math.round(def.xp * ELITE_MODIFIERS.xpMultiplier))
    expect(normal.health?.max).toBe(def.hp)
    expect(normal.attack?.damage).toBe(def.damage)
  })

  it("정예 생명체에는 공통 브레이크 게이지를 한 번만 부여한다", () => {
    const world = createWorld()
    const elite = spawnEnemy(world, "warrior", 0, 0, true)
    expect(elite.breakable?.max).toBe(ELITE_MODIFIERS.breakGauge)
    expect(elite.breakable?.current).toBe(ELITE_MODIFIERS.breakGauge)
  })

  it("보스의 고유 브레이크 계약은 정예 수식어에 덮어쓰지 않는다", () => {
    const world = createWorld()
    const boss = spawnEnemy(world, "boss", 0, 0, true)
    expect(boss.breakable?.max).toBe(ENEMY_DEFS.boss.breakGauge)
  })
})
