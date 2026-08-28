import { describe, expect, it } from "vitest"
import { createGame } from "../src/scenario/headless"
import { advance, attack, cast, distanceTo, livingEnemies, moveTo, nearestEnemy } from "../src/scenario/run"
import { Transcript } from "../src/scenario/text"

/**
 * 갱도 세로 슬라이스 시나리오 — 브라우저 없이 진짜 전투를 돌린다.
 *
 * 이 파일이 하는 일은 두 가지다.
 *  1. **전투 루프가 통째로 성립하는지** 확인한다. 지금까지 단위 테스트는 전부 순수 함수
 *     하나짜리였고 전체 루프를 도는 검증이 하나도 없었다.
 *  2. `SCENARIO_LOG=1 npx vitest run tests/scenario.mine.test.ts` 로 돌리면 한 판이
 *     통째로 **읽을 수 있는 글**로 나온다. 전투 수치를 만질 때 이걸 보고 판단한다.
 *
 * 조작은 전부 실제 의도 컴포넌트를 거친다 — 좌표를 손으로 옮기지 않는다.
 */

// @types/node 를 넣지 않고 환경 변수를 읽는다 — 이 저장소는 브라우저 타입만 쓴다.
const SHOW = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.SCENARIO_LOG === "1"

describe("갱도 세로 슬라이스", () => {
  it("진입 → 접근 → 교전 → 처치 → 전리품 까지 이어진다", () => {
    const game = createGame({ zoneId: "mine", seed: 7 })
    const t = new Transcript(game)

    t.scene("갱도 진입")
    t.status()
    t.map(9)

    const enemies0 = livingEnemies(game)
    expect(enemies0.length).toBeGreaterThan(0)
    t.say(`   적 ${enemies0.length}마리 배치됨`)

    // ── 접근: 가장 가까운 적에게 실제 이동 명령으로 걸어간다 ──────────────
    t.scene("접근")
    const target = nearestEnemy(game)!
    const startDist = distanceTo(game, target)
    moveTo(game, { x: target.transform!.position.x, z: target.transform!.position.z })
    t.events(advance(game, 3))
    t.status()
    const afterWalk = distanceTo(game, target)
    t.say(`   거리 ${startDist.toFixed(1)} → ${afterWalk.toFixed(1)}`)
    expect(afterWalk).toBeLessThan(startDist)

    // ── 교전: 공격 의도를 걸고 굴린다 ────────────────────────────────
    t.scene("교전")
    const hpBefore = target.health!.current
    attack(game, target)
    const events = advance(game, 4)
    t.events(events)
    t.status()

    expect(events.some((e) => e.kind === "swing")).toBe(true)
    expect(target.health!.current).toBeLessThan(hpBefore)
    t.say(`   대상 체력 ${hpBefore} → ${Math.round(target.health!.current)}`)

    // ── 회전베기: 분노가 찼으면 쓴다 ─────────────────────────────────
    const pc = game.player.player!
    if (pc.rage >= 25) {
      t.scene("회전베기")
      const rageBefore = pc.rage
      const p = game.player.transform!.position
      cast(game, "whirlwind", { x: p.x, z: p.z })
      const ww = advance(game, 1)
      t.events(ww)
      expect(pc.rage).toBeLessThan(rageBefore)
      expect(ww.some((e) => e.kind === "whirlwind")).toBe(true)
      t.say(`   분노 ${Math.round(rageBefore)} → ${Math.round(pc.rage)}`)
    }

    // ── 마무리: 죽을 때까지 계속 때린다 ──────────────────────────────
    t.scene("마무리")
    let killed = false
    for (let i = 0; i < 20 && !killed; i++) {
      const alive = nearestEnemy(game)
      if (!alive) break
      attack(game, alive)
      const evts = advance(game, 1)
      t.events(evts.filter((e) => e.kind !== "swing"))
      if (evts.some((e) => e.kind === "enemyDeath")) killed = true
    }
    t.status()
    expect(killed).toBe(true)

    if (SHOW) console.log(`\n${t}`)
  })

  it("교전 구역에 들어서면 적이 스스로 붙는다 — 추격이 실제로 작동한다", () => {
    const game = createGame({ zoneId: "mine", seed: 11, companions: false })
    const t = new Transcript(game)

    // 갱도 스폰(30, 84)은 가장 가까운 적과 17.9 떨어져 있고, 가장 넓은 어그로는 13(돌격병)이다.
    // **입구 방은 설계상 안전지대다** — 여기 서 있으면 아무 일도 안 일어나는 게 맞다.
    // 처음엔 이걸 모르고 "가만히 있으면 맞는다" 로 썼다가 이 하니스로 4초 만에 알았다.
    t.scene("입구 방에서 대기 5초 — 아무 일도 없어야 한다")
    const idle = advance(game, 5)
    expect(idle.filter((e) => e.kind === "playerHurt")).toHaveLength(0)
    expect(game.player.health!.current).toBe(100)
    t.status()

    t.scene("첫 교전 구역으로 전진 — 반격하지 않는다")
    const first = nearestEnemy(game)!
    const home = { ...first.transform!.position }
    moveTo(game, { x: home.x, z: home.z })

    // 죽기 전까지의 구간만 본다. 죽으면 부활해서 스폰으로 돌아가고 적은 idle 로 리셋되므로,
    // 그 뒤에 상태를 재면 "아무도 안 쫓아왔다" 는 엉뚱한 결론이 나온다 — 실제로 그랬다.
    let engaged = 0
    let hurt = 0
    for (let i = 0; i < 20 && !game.player.dead; i++) {
      const evts = advance(game, 0.5)
      hurt += evts.filter((e) => e.kind === "playerHurt").length
      const n = livingEnemies(game).filter((e) => e.enemy!.state === "chase" || e.enemy!.state === "attack").length
      if (n > engaged) engaged = n
    }
    t.status()
    t.say(`   최대 동시 교전 ${engaged}마리 · 피격 ${hurt}회 · ${game.player.dead ? "사망" : "생존"}`)

    // 공격 명령을 한 번도 내리지 않았는데 적이 스스로 붙어서 때려야 한다
    expect(engaged).toBeGreaterThan(0)
    expect(hurt).toBeGreaterThan(0)

    if (SHOW) console.log(`
${t}`)
  })
})
