import { describe, expect, it } from "vitest"
import { parseMap, TILE } from "../src/content/map"
import { MAP_LAYOUTS } from "../src/content/maps"
import { getPropDressing, planProps, propFiles } from "../src/systems/dungeonProps"
import { PROPS_BY_MAP } from "../src/content/dungeonKit"
import { TOWN_NPCS } from "../src/content/maps"

/**
 * 소품 배치 규칙.
 *
 * 이 소품들은 **충돌이 없는 순수 장식**이다. 그래서 어디에 놓느냐가 전부다 —
 * 통로 한복판에 놓이면 플레이어가 통 속을 걸어 지나가는 게 그대로 보이고,
 * 스폰 지점을 덮으면 첫 화면이 물건으로 가려진다.
 *
 * 배치가 순수 함수라 브라우저 없이 여기서 전부 검증한다.
 */

const ids = Object.keys(MAP_LAYOUTS)

describe("소품 배치", () => {
  it("카탈로그의 모든 파일이 로딩 목록에 들어간다", () => {
    const files = new Set(propFiles())
    for (const list of Object.values(PROPS_BY_MAP)) {
      for (const p of list) expect(files.has(p.file), `${p.file} 누락`).toBe(true)
    }
    expect(files.size).toBeGreaterThan(0)
  })

  describe.each(ids)("맵 %s", (id) => {
    const map = parseMap(MAP_LAYOUTS[id]!)
    const placements = planProps(map, id)

    it("통행 칸에만 놓는다", () => {
      for (const p of placements) {
        const c = Math.round(p.x / TILE)
        const r = Math.round(p.z / TILE)
        expect(map.walls[r]?.[c], `(${c},${r}) 는 벽이다`).toBe(false)
      }
    })

    it("벽에 맞닿지 않은 칸(통로 한복판)에는 놓지 않는다", () => {
      for (const p of placements) {
        const c = Math.round(p.x / TILE)
        const r = Math.round(p.z / TILE)
        const open =
          !(map.walls[r]?.[c + 1] ?? true) &&
          !(map.walls[r]?.[c - 1] ?? true) &&
          !(map.walls[r + 1]?.[c] ?? true) &&
          !(map.walls[r - 1]?.[c] ?? true)
        expect(open, `(${c},${r}) 가 사방이 트인 칸인데 소품이 있다`).toBe(false)
      }
    })

    it("스폰 지점과 보스 지점을 막지 않는다", () => {
      const guarded = [map.playerSpawn, map.bossSpawn, ...map.spawns]
      for (const p of placements) {
        for (const g of guarded) {
          if (g.x === 0 && g.z === 0) continue // 보스 없음
          expect(Math.hypot(g.x - p.x, g.z - p.z), `(${p.x},${p.z}) 가 스폰을 막는다`).toBeGreaterThan(3)
        }
      }
    })

    it("마을 NPC 자리를 막지 않는다", () => {
      if (id !== "town") return
      for (const n of TOWN_NPCS) {
        const nx = n.cell.col * TILE
        const nz = n.cell.row * TILE
        for (const p of placements) {
          expect(Math.hypot(nx - p.x, nz - p.z), n.name + " 앞이 막혔다").toBeGreaterThan(3)
        }
      }
    })

    it("같은 칸에 두 개가 겹치지 않는다", () => {
      const seen = new Set<string>()
      for (const p of placements) {
        const key = `${p.x},${p.z}`
        expect(seen.has(key), `${key} 중복`).toBe(false)
        seen.add(key)
      }
    })

    it("결정적이다 — 같은 맵은 항상 같은 배치", () => {
      const again = planProps(map, id)
      expect(again).toEqual(placements)
    })

    it("밀도가 설정값 근처다", () => {
      // 전투 맵은 소품이 실제로 놓여야 한다. 마을도 마찬가지.
      if (getPropDressing(id).density > 0.1 && (PROPS_BY_MAP[id]?.length ?? 0) > 0) {
        expect(placements.length).toBeGreaterThan(0)
      }
      // 어수선해지지 않게 상한도 본다 — 통행 칸의 절반을 넘으면 길이 막힌 것처럼 보인다
      let walkableCells = 0
      for (const row of map.walls) for (const w of row) if (!w) walkableCells++
      expect(placements.length).toBeLessThan(walkableCells * 0.5)
    })
  })
})
