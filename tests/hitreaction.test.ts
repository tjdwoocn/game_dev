import { describe, expect, it } from "vitest"
import { createWorld } from "../src/core/world"
import { applyHitstun, applyKnockback } from "../src/systems/movement"

describe("hit reaction", () => {
  it("히트스턴 적용 시 기존 이동 명령과 경로를 끊는다", () => {
    const world = createWorld()
    const entity = world.add({
      transform: { position: { x: 0, y: 0, z: 0 }, yaw: 0 },
      moveTarget: { x: 4, z: 4 },
      path: { nodes: [{ x: 1, z: 1 }], index: 0, goal: { x: 4, z: 4 }, stuck: 0 },
    })

    applyHitstun(world, entity, 1.2)

    expect(entity.hitstun?.until).toBe(1.2)
    expect(entity.moveTarget).toBeUndefined()
    expect(entity.path).toBeUndefined()
  })

  it("넉백 병합 시 더 강한 속도와 더 긴 시간을 보존한다", () => {
    const world = createWorld()
    const entity = world.add({
      knockback: { dir: { x: 1, z: 0 }, speed: 2, until: 1 },
    })

    applyKnockback(world, entity, { x: 0, z: 3 }, 5, 2)

    expect(entity.knockback?.dir).toEqual({ x: 0, z: 1 })
    expect(entity.knockback?.speed).toBe(5)
    expect(entity.knockback?.until).toBe(2)
  })
})
