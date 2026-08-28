import { describe, expect, it } from "vitest"
import { spawnEnemy } from "../src/content/enemies"
import { createGame } from "../src/scenario/headless"
import { advance, STEP } from "../src/scenario/run"
import { dealDamage } from "../src/systems/combat"
import { isBreakExposed } from "../src/systems/break"

function spawnChargerInLane(game: ReturnType<typeof createGame>) {
  // 마을 장식 소품은 이 테스트의 대상이 아니다. 충돌 프록시가 플레이어를
  // 밀어내면 돌진의 실제 접촉 경로와 무관한 움직임이 섞인다.
  for (const prop of [...game.world.with("destructible")]) game.world.remove(prop)
  const p = game.player.transform!.position
  return spawnEnemy(game.world, "charger", p.x, p.z - 4)
}

describe("돌진형 적 행동 계약", () => {
  it("사거리 안에서 windup을 먼저 내고, 준비 중에는 피해를 주지 않는다", () => {
    const game = createGame({ zoneId: "mine", seed: 601, companions: false })
    const charger = spawnChargerInLane(game)
    const hpBefore = game.player.health!.current

    const firstEvents = advance(game, STEP)

    expect(charger.enemyAction?.actionId).toBe("charge")
    expect(charger.enemyAction?.phase).toBe("windup")
    expect(firstEvents.some((event) =>
      event.kind === "enemyWindup" && event.entity === charger && event.enemyActionId === "charge",
    )).toBe(true)

    advance(game, 0.2)
    expect(game.player.health!.current).toBe(hpBefore)
  })

  it("행동 이벤트가 정예 표식을 표현 계층까지 보존한다", () => {
    const game = createGame({ zoneId: "mine", seed: 606, companions: false })
    for (const prop of [...game.world.with("destructible")]) game.world.remove(prop)
    const p = game.player.transform!.position
    const charger = spawnEnemy(game.world, "charger", p.x, p.z - 4, true)
    charger.enemy!.state = "chase"

    const events = advance(game, STEP)
    const windup = events.find((event) => event.kind === "enemyWindup" && event.entity === charger)
    expect(windup?.elite).toBe(true)
    expect(windup?.enemyActionInstanceId).toBeGreaterThan(0)
  })

  it("active에서 잠긴 방향으로 이동하며 한 번만 접촉한다", () => {
    const game = createGame({ zoneId: "town", seed: 602, companions: false })
    const charger = spawnChargerInLane(game)
    const events = advance(game, 1.2)
    const hurts = events.filter((event) => event.kind === "playerHurt" && event.entity === game.player)

    expect(hurts).toHaveLength(1)
    expect(charger.enemyAction?.hasHit || !charger.enemyAction).toBe(true)
    expect(game.player.health!.current).toBeLessThan(game.player.health!.max)
  })

  it("windup은 피격 경직으로 취소되고 활성 돌진으로 이어지지 않는다", () => {
    const game = createGame({ zoneId: "town", seed: 603, companions: false })
    const charger = spawnChargerInLane(game)
    advance(game, STEP)
    expect(charger.enemyAction?.phase).toBe("windup")

    dealDamage(game.world, game.res, game.player, charger, 10)
    advance(game, STEP)

    expect(charger.enemyAction).toBeUndefined()
    expect(game.player.health!.current).toBe(game.player.health!.max)
  })

  it("피격 경로의 현재 진행량까지만 판정해 벽 너머 접촉을 만들지 않는다", () => {
    const game = createGame({ zoneId: "town", seed: 604, companions: false })
    const charger = spawnChargerInLane(game)
    const p = game.player.transform!.position
    const col = Math.round(p.x / 2)
    const row = Math.round((p.z - 2) / 2)
    game.res.map.walls[row]![col] = true

    const hpBefore = game.player.health!.current
    const events = advance(game, 1.2)

    expect(game.player.health!.current).toBe(hpBefore)
    expect(events.some((event) => event.kind === "playerHurt" && event.entity === game.player)).toBe(false)
    expect(charger.transform!.position.z).toBeLessThan(p.z - 1.5)
  })

  it("정예 돌격병은 windup 동안 브레이크 창을 연다", () => {
    const game = createGame({ zoneId: "mine", seed: 605, companions: false })
    const charger = spawnChargerInLane(game)
    // 테스트 대상만 정예로 만들어 데이터 수식어와 전용 행동을 함께 검증한다.
    game.world.remove(charger)
    const p = game.player.transform!.position
    const elite = spawnEnemy(game.world, "charger", p.x, p.z - 4, true)
    elite.enemy!.state = "chase"

    advance(game, STEP)

    expect(elite.enemyAction?.phase).toBe("windup")
    expect(elite.breakable).toBeDefined()
    expect(isBreakExposed(elite.breakable!, game.res.time.now)).toBe(true)
  })
})
