import { describe, it, expect } from "vitest"
import { ZONE_DEFS, validateZoneMaps } from "../src/content/zones"
import { MAP_LAYOUTS } from "../src/content/maps"

/**
 * 존 계약의 참조 무결성 검증.
 *
 * validateZoneMaps 는 "존재하지 않는 맵·출구"는 잡지만, **아무도 가리키지 않는 존**은
 * 잡지 못한다. 정의만 되어 있고 도달할 수 없는 존은 존재하지 않는 것과 같으므로
 * 여기서 따로 확인한다. 맵 콘텐츠와 존 계약이 어긋나는 것도 같이 본다.
 */

describe("존 계약", () => {
  it("존이 가리키는 맵과 출구가 모두 존재한다", () => {
    expect(validateZoneMaps()).toEqual([])
  })

  /**
   * 아직 아무도 가리키지 않는 존. 존 그래프가 완성되면 이 목록은 비어야 한다.
   * 여기 이름을 적어 두는 이유는 기존 공백 때문에 **새로 생긴** 고립 존을 놓치지 않기 위해서다.
   * (`cistern` 은 zones.ts 에 정의돼 있으나 어떤 존도 출구로 연결하지 않았다)
   */
  const KNOWN_UNREACHABLE = ["cistern"]

  it("마을에서 도달할 수 없는 존이 새로 생기지 않는다", () => {
    const seen = new Set<string>(["town"])
    const queue = ["town"]
    while (queue.length > 0) {
      const cur = ZONE_DEFS[queue.shift()!]
      if (!cur) continue
      for (const exit of cur.exits) {
        if (seen.has(exit.targetZoneId)) continue
        seen.add(exit.targetZoneId)
        queue.push(exit.targetZoneId)
      }
    }
    const unreachable = Object.keys(ZONE_DEFS).filter((id) => !seen.has(id))
    const unexpected = unreachable.filter((id) => !KNOWN_UNREACHABLE.includes(id))
    expect(unexpected, `새로 고립된 존: ${unexpected.join(", ")}`).toEqual([])
    if (unreachable.length > 0) {
      console.log(`  [알림] 아직 도달 불가한 존: ${unreachable.join(", ")}`)
    }
  })

  it("제작된 맵 중 존에 연결되지 않은 것을 보고한다", () => {
    const used = new Set(Object.values(ZONE_DEFS).map((z) => z.mapId))
    const orphanMaps = Object.keys(MAP_LAYOUTS).filter((id) => !used.has(id))
    // 실패가 아니라 현황 확인용이다 — 존 런타임이 붙는 대로 채워 나간다.
    expect(Array.isArray(orphanMaps)).toBe(true)
    if (orphanMaps.length > 0) {
      console.log(`  [알림] 존에 연결되지 않은 맵: ${orphanMaps.join(", ")}`)
    }
  })
})
