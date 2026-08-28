import { describe, expect, it } from "vitest"
import { createGameplayEventBuffer, drainGameplayEvents } from "../src/core/events"
import { createGame } from "../src/scenario/headless"
import { advance, cast } from "../src/scenario/run"
import { enterZone } from "../src/systems/zone"
import { applyHitstun } from "../src/systems/movement"

function skillEvents(events: ReturnType<typeof advance>) {
  return events.filter((event) => event.kind === "skillWindup" || event.kind === "dash" || event.kind === "whirlwind" || event.kind === "skillRelease")
}

describe("스킬 시전 이벤트 계약", () => {
  it("이벤트 버퍼는 시퀀스를 유지하고 drain 후 비워진다", () => {
    const buffer = createGameplayEventBuffer()
    expect(buffer.nextCastId).toBe(1)
    expect(drainGameplayEvents(buffer)).toEqual([])
    expect(buffer.pending).toHaveLength(0)
  })

  it("시전 수락은 windup을 먼저 내고 release까지 같은 castId를 유지한다", () => {
    const game = createGame({ zoneId: "mine", seed: 101, companions: false })
    const pc = game.player.player!
    pc.rage = 25

    const baseline = advance(game, 0.01)
    expect(skillEvents(baseline)).toHaveLength(0)

    cast(game, "whirlwind", { x: 30, z: 20 })
    const windup = skillEvents(advance(game, 0.05))
    expect(windup).toHaveLength(1)
    expect(windup[0]?.kind).toBe("skillWindup")
    expect(windup[0]?.skillId).toBe("whirlwind")
    expect(windup[0]?.phase).toBe("windup")
    expect(game.player.action?.phase).toBe("windup")

    const positionAtWindup = { ...windup[0]!.at! }
    game.player.transform!.position.x += 2
    const release = skillEvents(advance(game, 0.15))
    expect(release).toHaveLength(1)
    expect(release[0]?.kind).toBe("whirlwind")
    expect(release[0]?.skillId).toBe("whirlwind")
    expect(release[0]?.phase).toBe("release")
    expect(release[0]?.castId).toBe(windup[0]?.castId)
    expect(windup[0]?.at).toEqual(positionAtWindup)
    expect(game.player.action?.phase).toBe("recovery")
    expect(pc.rage).toBe(0)
  })

  it("자원·해금·쿨다운으로 거절된 입력은 이벤트와 action을 만들지 않는다", () => {
    const game = createGame({ zoneId: "mine", seed: 102, companions: false })
    const pc = game.player.player!
    pc.rage = 0

    cast(game, "whirlwind", { x: 30, z: 20 })
    const events = skillEvents(advance(game, 0.3))
    expect(events).toHaveLength(0)
    expect(game.player.action).toBeUndefined()
    expect(pc.rage).toBe(0)
  })

  it("recovery 중 입력 하나는 버퍼되어 종료 직후 다음 windup으로 승격된다", () => {
    const game = createGame({ zoneId: "mine", seed: 103, companions: false })
    const pc = game.player.player!
    pc.rage = 50

    cast(game, "whirlwind", { x: 30, z: 20 })
    advance(game, 0.2)
    expect(game.player.action?.phase).toBe("recovery")

    advance(game, 0.18)
    cast(game, "dash", { x: 31, z: 20 })
    const buffered = skillEvents(advance(game, 0.1))
    const windups = buffered.filter((event) => event.kind === "skillWindup")
    expect(windups).toHaveLength(1)
    expect(windups[0]?.skillId).toBe("dash")
    expect(windups[0]?.castId).not.toBeUndefined()
    expect(pc.rage).toBe(25)
    expect(game.player.action?.phase).toBe("windup")
  })

  it("입력 버퍼는 180ms를 넘기면 recovery 종료 시 폐기된다", () => {
    const game = createGame({ zoneId: "mine", seed: 106, companions: false })
    const pc = game.player.player!
    pc.rage = 25

    cast(game, "whirlwind", { x: 30, z: 20 })
    advance(game, 0.2)
    cast(game, "dash", { x: 31, z: 20 })
    const events = skillEvents(advance(game, 0.3))

    expect(events.filter((event) => event.kind === "skillWindup")).toHaveLength(0)
    expect(game.player.action).toBeUndefined()
    expect(game.player.skillBuffer).toBeUndefined()
  })

  it("피격 경직과 존 전환은 진행 중 시전·버퍼를 모두 정리한다", () => {
    const game = createGame({ zoneId: "mine", seed: 104, companions: false })
    const pc = game.player.player!
    pc.rage = 50

    cast(game, "whirlwind", { x: 30, z: 20 })
    advance(game, 0.05)
    expect(game.player.action).toBeDefined()
    applyHitstun(game.world, game.player, game.res.time.now + 1)
    expect(skillEvents(advance(game, 0.3)).filter((event) => event.phase === "release")).toHaveLength(0)
    expect(game.player.action).toBeDefined()
    expect(game.player.skillBuffer).toBeUndefined()

    const zoneGame = createGame({ zoneId: "mine", seed: 105, companions: false })
    zoneGame.player.player!.rage = 25
    cast(zoneGame, "whirlwind", { x: 30, z: 20 })
    advance(zoneGame, 0.05)
    expect(zoneGame.player.action).toBeDefined()
    expect(enterZone(zoneGame.world, zoneGame.res, zoneGame.runtime, "town")).toBe(true)
    expect(zoneGame.player.action).toBeUndefined()
    expect(zoneGame.player.skillBuffer).toBeUndefined()
  })
})
