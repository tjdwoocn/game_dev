import { describe, it, expect } from "vitest"
import { parseMap, isWalkable, TILE } from "../src/content/map"
import { findPath } from "../src/core/pathfind"
import { MAP_LAYOUTS, TOWN_LAYOUT, TOWN_NPCS } from "../src/content/maps"

/**
 * 손으로 그린 아스키 레이아웃은 눈으로 검사할 수 없다.
 * 격자가 성립하는지, 그리고 모든 스폰 지점이 실제로 도달 가능한지 여기서 검증한다.
 * 맵의 성격(일반/보스/마을)은 별도 메타데이터가 아니라 레이아웃 내용에서 그대로 읽는다.
 */

const PLAYER_RADIUS = 0.45
const entries = Object.entries(MAP_LAYOUTS)

describe.each(entries)("맵 %s", (id, layout) => {
  const flat = layout.join("")
  const parsed = parseMap(layout)
  const hasBoss = flat.includes("B")
  const enemyCount = parsed.spawns.length

  it("모든 행의 길이가 같다", () => {
    expect([...new Set(layout.map((row) => row.length))]).toHaveLength(1)
  })

  it("허용된 문자만 사용한다", () => {
    for (const row of layout) expect(row).toMatch(/^[#.PwacB]+$/)
  })

  it("외곽이 벽으로 닫혀 있다", () => {
    expect(layout[0]).toMatch(/^#+$/)
    expect(layout[layout.length - 1]).toMatch(/^#+$/)
    for (const row of layout) {
      expect(row[0]).toBe("#")
      expect(row[row.length - 1]).toBe("#")
    }
  })

  it("플레이어 시작 지점이 정확히 하나이고 통행 가능하다", () => {
    expect(flat.split("P").length - 1).toBe(1)
    expect(isWalkable(parsed, parsed.playerSpawn.x, parsed.playerSpawn.z)).toBe(true)
  })

  it("보스 표시는 최대 하나다", () => {
    expect(flat.split("B").length - 1).toBeLessThanOrEqual(1)
  })

  it("모든 적 스폰 지점에 실제로 도달할 수 있다", () => {
    for (const spawn of parsed.spawns) {
      expect(isWalkable(parsed, spawn.x, spawn.z)).toBe(true)
      const path = findPath(parsed, parsed.playerSpawn, { x: spawn.x, z: spawn.z }, PLAYER_RADIUS)
      expect(path, `${id}: 적 스폰 (${spawn.x},${spawn.z}) 도달 불가`).not.toBeNull()
    }
  })

  it("보스가 있으면 보스 지점에 도달할 수 있다", () => {
    if (!hasBoss) return
    expect(isWalkable(parsed, parsed.bossSpawn.x, parsed.bossSpawn.z)).toBe(true)
    const path = findPath(parsed, parsed.playerSpawn, parsed.bossSpawn, PLAYER_RADIUS)
    expect(path, `${id}: 보스 지점 도달 불가`).not.toBeNull()
  })

  /**
   * 예전 계약은 "보스가 있으면 잡몹이 없다" 였다. 보스방 3곳을 마을 메뉴에서 따로
   * 고르던 구조의 계약이다. 세로 슬라이스로 바꾸면서 **갱도 끝이 곧 보스방**이 됐고,
   * 그래서 갱도는 잡몹과 보스를 함께 갖는다 — 그게 한 판의 형태다.
   *
   * 지금 지켜야 할 것은 "전용 보스방(잡몹 0)" 이 아니라 "전투 맵에는 적이 있다" 이다.
   */
  it("전투 맵에는 적이 배치돼 있다", () => {
    if (id === "town") { expect(enemyCount).toBe(0); return }
    if (hasBoss && enemyCount === 0) return // 전용 보스방 — 보스 하나로 성립한다
    expect(enemyCount).toBeGreaterThanOrEqual(4)
  })
})

describe("마을", () => {
  const parsed = parseMap(TOWN_LAYOUT)

  it("적이 하나도 없다", () => {
    expect(parsed.spawns).toHaveLength(0)
    expect(TOWN_LAYOUT.join("")).not.toContain("B")
  })

  it("NPC 역할이 중복되지 않는다", () => {
    const roles = TOWN_NPCS.map((n) => n.role)
    expect(new Set(roles).size).toBe(roles.length)
  })

  it("NPC끼리 같은 칸에 겹치지 않는다", () => {
    const cells = TOWN_NPCS.map((n) => `${n.cell.col},${n.cell.row}`)
    expect(new Set(cells).size).toBe(cells.length)
  })

  it("모든 NPC가 건물 안이 아니라 통행 가능한 바닥에 선다", () => {
    for (const npc of TOWN_NPCS) {
      const x = npc.cell.col * TILE
      const z = npc.cell.row * TILE
      expect(isWalkable(parsed, x, z), `${npc.name}: (${npc.cell.col},${npc.cell.row}) 통행 불가`).toBe(true)
    }
  })

  it("모든 NPC에게 플레이어가 걸어갈 수 있다", () => {
    for (const npc of TOWN_NPCS) {
      const goal = { x: npc.cell.col * TILE, z: npc.cell.row * TILE }
      const path = findPath(parsed, parsed.playerSpawn, goal, PLAYER_RADIUS)
      expect(path, `${npc.name}: 도달 불가`).not.toBeNull()
    }
  })
})
