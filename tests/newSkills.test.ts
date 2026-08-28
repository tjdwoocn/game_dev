import { describe, expect, it } from "vitest"
import type { Entity } from "../src/core/world"
import { createGame } from "../src/scenario/headless"
import { advance, cast } from "../src/scenario/run"
import { collectCombatEvents } from "../src/systems/combatEvents"
import { dealDamage } from "../src/systems/combat"
import { enterZone } from "../src/systems/zone"

const enemySource = (x: number, z: number): Entity => ({
  transform: { position: { x, y: 0, z }, yaw: 0 },
  enemy: { kind: "warrior", state: "attack", home: { x, y: 0, z }, stateSince: 0 },
})

function skillEvents(events: ReturnType<typeof advance>) {
  return events.filter((event) => event.kind === "skillWindup" || event.kind === "dash" || event.kind === "whirlwind" || event.kind === "skillRelease")
}

describe("guard / execution 스킬", () => {
  it("guard는 release부터 피해를 줄이지만 경직·넉백 면역은 주지 않는다", () => {
    const game = createGame({ zoneId: "mine", seed: 201, companions: false })
    const pc = game.player.player!
    pc.level = 2
    pc.rage = 20
    const p = game.player.transform!.position

    cast(game, "guard", { x: p.x, z: p.z })
    const windup = skillEvents(advance(game, 0.05))
    expect(windup).toHaveLength(1)
    expect(windup[0]?.skillId).toBe("guard")
    expect(windup[0]?.phase).toBe("windup")
    expect(pc.rage).toBe(0)
    expect(game.player.guarding).toBeUndefined()

    const release = skillEvents(advance(game, 0.15))
    expect(release).toHaveLength(1)
    expect(release[0]?.skillId).toBe("guard")
    expect(release[0]?.phase).toBe("release")
    expect(game.player.guarding?.damageMultiplier).toBe(0.5)

    const source = enemySource(p.x - 1, p.z)
    dealDamage(game.world, game.res, source, game.player, 40)
    const damageEvents = collectCombatEvents(game.world, game.res)
    const hurt = damageEvents.find((event) => event.kind === "playerHurt")
    expect(game.player.health!.current).toBe(80)
    expect(hurt?.amount).toBe(20)
    expect(game.player.hitstun).toBeDefined()
    expect(game.player.knockback).toBeDefined()
  })

  it("guard 중에는 다른 스킬이 시작되지 않고, 존 전환 시 방어 상태가 정리된다", () => {
    const game = createGame({ zoneId: "mine", seed: 202, companions: false })
    const pc = game.player.player!
    pc.level = 2
    pc.rage = 20
    const p = game.player.transform!.position

    cast(game, "guard", { x: p.x, z: p.z })
    advance(game, 0.2)
    expect(game.player.guarding).toBeDefined()

    cast(game, "dash", { x: p.x + 6, z: p.z })
    const blocked = skillEvents(advance(game, 0.5))
    expect(blocked.some((event) => event.skillId === "dash" && event.phase === "windup")).toBe(false)
    expect(pc.cooldowns.dash).toBe(0)

    expect(enterZone(game.world, game.res, game.runtime, "town")).toBe(true)
    expect(game.player.guarding).toBeUndefined()
  })

  it("execution은 HP 임계값을 만족한 가장 가까운 적에게만 치명타·브레이크를 적용한다", () => {
    const game = createGame({ zoneId: "mine", seed: 203, companions: false })
    const pc = game.player.player!
    pc.level = 3
    pc.rage = 35
    pc.critChance = 100
    pc.critDamage = 200
    const p = game.player.transform!.position
    const target = game.world.with("enemy", "health", "transform").entities.find((entity) => !entity.boss)!
    target.health.current = 175
    target.health.max = 500
    target.transform.position.x = p.x + 2.1
    target.transform.position.z = p.z
    target.attack!.readyAt = 999
    game.world.addComponent(target, "breakable", {
      current: 200, max: 200, exposedUntil: 10, brokenUntil: 0, vulnerabilityUntil: 0,
    })

    cast(game, "execution", { x: target.transform.position.x, z: target.transform.position.z })
    const beforeRelease = skillEvents(advance(game, 0.2))
    expect(beforeRelease.some((event) => event.skillId === "execution" && event.phase === "release")).toBe(false)
    expect(target.health.current).toBe(175)
    expect(pc.rage).toBe(0)

    const afterRelease = advance(game, 0.15)
    const release = skillEvents(afterRelease).find((event) => event.skillId === "execution" && event.phase === "release")
    const critical = afterRelease.find((event) => event.kind === "crit" && event.entity === target)
    expect(release).toBeDefined()
    expect(critical?.amount).toBe(98)
    expect(target.health.current).toBe(77)
    expect(target.breakable?.current).toBe(182)
    expect(target.dead).toBeUndefined()
  })

  it("execution은 HP 경계 밖이면 비용 없이 거절하고, release 전에 멀어지면 피해를 주지 않는다", () => {
    const rejected = createGame({ zoneId: "mine", seed: 204, companions: false })
    const rejectedPc = rejected.player.player!
    rejectedPc.level = 3
    rejectedPc.rage = 35
    const rejectedTarget = rejected.world.with("enemy", "health", "transform").entities.find((entity) => !entity.boss)!
    rejectedTarget.health.max = 500
    rejectedTarget.health.current = 176 // 35%를 초과하는 경계 밖
    const rp = rejected.player.transform!.position
    rejectedTarget.transform.position.x = rp.x + 2.1
    rejectedTarget.transform.position.z = rp.z
    cast(rejected, "execution", { x: rp.x, z: rp.z })
    expect(skillEvents(advance(rejected, 0.4))).toHaveLength(0)
    expect(rejectedPc.rage).toBe(35)
    expect(rejected.player.action).toBeUndefined()

    const moved = createGame({ zoneId: "mine", seed: 205, companions: false })
    const movedPc = moved.player.player!
    movedPc.level = 3
    movedPc.rage = 35
    const movedTarget = moved.world.with("enemy", "health", "transform").entities.find((entity) => !entity.boss)!
    movedTarget.health.max = 500
    movedTarget.health.current = 175
    const mp = moved.player.transform!.position
    movedTarget.transform.position.x = mp.x + 2.1
    movedTarget.transform.position.z = mp.z
    cast(moved, "execution", { x: movedTarget.transform.position.x, z: movedTarget.transform.position.z })
    advance(moved, 0.1)
    movedTarget.transform.position.x += 10
    const before = movedTarget.health.current
    const events = advance(moved, 0.3)
    expect(events.some((event) => event.skillId === "execution" && event.phase === "release")).toBe(true)
    expect(movedTarget.health.current).toBe(before)
    expect(movedPc.rage).toBe(0)
  })
})
