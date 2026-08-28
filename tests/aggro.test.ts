import { describe, expect, it } from "vitest"
import { createWorld } from "../src/core/world"
import { ENEMY_DEFS } from "../src/content/enemies"
import { movementSpeed } from "../src/systems/movement"
import { selectPartyTarget } from "../src/systems/party"

describe("aggro pursuit", () => {
  it("전사는 추격 중 플레이어보다 빠른 속도를 사용한다", () => {
    const enemy = {
      enemy: { kind: "warrior" as const, state: "chase" as const, home: { x: 0, y: 0, z: 0 }, stateSince: 0 },
    }

    expect(movementSpeed(enemy)).toBeGreaterThan(6)
    expect(ENEMY_DEFS.warrior.aggroRange).toBeGreaterThanOrEqual(10)
  })

  it("적 앞을 달리는 플레이어를 뒤쪽 탱커보다 우선한다", () => {
    const world = createWorld()
    const player = world.add({
      player: {} as never,
      transform: { position: { x: 0, y: 0, z: 48 }, yaw: 0 },
      health: { current: 100, max: 100 },
    })
    world.add({
      companion: { role: "tank" } as never,
      transform: { position: { x: 0, y: 0, z: 49.5 }, yaw: 0 },
      health: { current: 100, max: 100 },
    })
    const enemy = world.add({ transform: { position: { x: 0, y: 0, z: 40 }, yaw: 0 } })

    expect(selectPartyTarget(world, enemy)).toBe(player)
  })

  it("탱커가 실제로 더 가까우면 탱커 역할을 유지한다", () => {
    const world = createWorld()
    world.add({
      player: {} as never,
      transform: { position: { x: 0, y: 0, z: 44 }, yaw: 0 },
      health: { current: 100, max: 100 },
    })
    const tank = world.add({
      companion: { role: "tank" } as never,
      transform: { position: { x: 0, y: 0, z: 41.5 }, yaw: 0 },
      health: { current: 100, max: 100 },
    })
    const enemy = world.add({ transform: { position: { x: 0, y: 0, z: 40 }, yaw: 0 } })

    expect(selectPartyTarget(world, enemy)).toBe(tank)
  })
})
