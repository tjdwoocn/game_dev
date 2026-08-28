import { describe, expect, it } from "vitest"
import { createGame, type Game } from "../src/scenario/headless"
import { advance, attack, cast, distanceTo, livingEnemies, moveTo, nearestEnemy, type TimedEvent } from "../src/scenario/run"
import { Transcript } from "../src/scenario/text"

/**
 * 세로 슬라이스 완주 — **마을 → 갱도 → 교전 → 정예 → 보스 → 귀환**.
 *
 * 이게 이 프로젝트의 단 하나의 목표다. 이 테스트는 두 가지를 한다:
 *  1. **구조**가 성립하는지 — 세 종류 + 정예 + 보스가 한 맵에 있고 한 판이 끊기지 않는가
 *  2. **밸런스 수치**를 기록한다 — 소요 시간, 잃은 체력, 보스 처치 시간
 *
 * 2번은 통과/실패가 아니라 **관측**이다. 수치를 만질 때마다 여기서 바로 읽는다.
 * `SCENARIO_LOG=1` 로 한 판 전체를 글로 볼 수 있다.
 */

const SHOW = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.SCENARIO_LOG === "1"

interface Report {
  seconds: number
  damageTaken: number
  levelStart: number
  levelEnd: number
  kills: number
  bossKilled: boolean
  bossTtk: number | null
  playerHits: number
  loot: number
}

/**
 * 갱도를 끝까지 밀어붙인다. 사람이 하는 것과 같은 방식 —
 * 보이면 때리고, 없으면 북쪽으로 간다. 순간이동도 스탯 조작도 없다.
 */
function runDungeon(game: Game, t: Transcript, maxSeconds = 300): Report {
  const hp0 = game.player.health!.current
  const lv0 = game.player.player!.level
  const startedAt = game.res.time.now
  let kills = 0
  let playerHits = 0
  let damageTaken = 0
  let lastHp = hp0
  let bossKilled = false
  let bossFirstHitAt: number | null = null
  let bossDeadAt: number | null = null
  let elapsed = 0

  while (elapsed < maxSeconds) {
    const target = nearestEnemy(game)
    let events: TimedEvent[]

    if (target && distanceTo(game, target) < 14) {
      // 사람은 분노가 차면 쓴다. 스킬을 하나도 안 쓰는 봇으로 재면 난이도가 과대평가된다 —
      // 실제로 회전베기를 빼고 돌렸을 때 43초에 죽었다.
      const pc = game.player.player!
      const p = game.player.transform!.position
      if (pc.rage >= 25 && distanceTo(game, target) < 3.5) {
        cast(game, "whirlwind", { x: p.x, z: p.z })
        events = advance(game, 0.4)
      } else {
        attack(game, target)
        events = advance(game, 0.4)
      }
    } else {
      // 아무도 안 보이면 북쪽(보스방)으로 전진한다
      const p = game.player.transform!.position
      if (p.z <= 8.5) { advance(game, 0.4); continue }  // 보스방 도착 — 보스가 죽을 때까지 싸운다
      moveTo(game, { x: p.x, z: Math.max(7, p.z - 8) })
      events = advance(game, 0.6)
    }
    elapsed = game.res.time.now - startedAt
    const hpNow = game.player.health!.current
    if (hpNow < lastHp) damageTaken += lastHp - hpNow
    lastHp = hpNow

    for (const e of events) {
      if (e.kind === "enemyDeath") {
        kills++
        t.events([e])
        if (e.entity?.boss) { bossKilled = true; bossDeadAt = e.t }
      }
      if (e.kind === "playerHurt") playerHits++
      if (e.kind === "levelUp" || e.kind === "breakSuccess") t.events([e])
      if (e.entity?.boss && (e.kind === "hit" || e.kind === "hitHeavy") && bossFirstHitAt === null) {
        bossFirstHitAt = e.t
      }
    }
    if (game.player.dead) break
    if (bossKilled) break
  }

  return {
    seconds: +(game.res.time.now - startedAt).toFixed(1),
    damageTaken: Math.round(damageTaken),
    levelStart: lv0,
    levelEnd: game.player.player!.level,
    kills,
    bossKilled,
    bossTtk: bossFirstHitAt !== null && bossDeadAt !== null ? +(bossDeadAt - bossFirstHitAt).toFixed(1) : null,
    playerHits,
    loot: game.player.player!.inventory.length,
  }
}

describe("세로 슬라이스 완주", () => {
  it("구조: 세 종류 + 정예 + 보스가 한 맵에 있고 한 판이 끊기지 않는다", () => {
    const game = createGame({ zoneId: "mine", seed: 5 })
    const t = new Transcript(game)

    t.scene("갱도 진입")
    t.status()
    const roster = livingEnemies(game)
    const kinds = new Set(roster.map((e) => e.enemy!.kind))
    t.say(`   적 ${roster.length} · 종류 ${[...kinds].join("/")}`)

    expect(kinds.has("warrior")).toBe(true)
    expect(kinds.has("archer")).toBe(true)
    expect(kinds.has("charger")).toBe(true)
    expect(roster.some((e) => e.enemy!.isElite)).toBe(true)
    expect(roster.some((e) => e.boss)).toBe(true)

    t.scene("완주")
    const r = runDungeon(game, t)
    t.status()
    t.scene("리포트")
    t.say(`   소요 ${r.seconds}초 · 처치 ${r.kills} · 보스 ${r.bossKilled ? "처치" : "생존"} (TTK ${r.bossTtk ?? "-"}초)`)
    t.say(`   받은 피해 ${r.damageTaken} · 피격 ${r.playerHits}회 · Lv.${r.levelStart}→${r.levelEnd} · 전리품 ${r.loot}`)

    if (SHOW) console.log(`\n${t}`)

    expect(game.player.dead).toBeFalsy()
    expect(r.bossKilled).toBe(true)
    // 보스를 잡고 나면 뒤에 몇몇 남아 있을 수 있다 — 플레이어가 지나쳐 온 것이다.
    // 확인할 것은 "끝까지 갔는가" 이지 "전멸시켰는가" 가 아니다.
    expect(livingEnemies(game).some((e) => e.boss)).toBe(false)
  })

  it("밸런스 관측: 한 판이 너무 짧거나 너무 쉬우면 여기서 드러난다", () => {
    const game = createGame({ zoneId: "mine", seed: 5 })
    const t = new Transcript(game)
    const r = runDungeon(game, t)

    if (SHOW) {
      console.log(`\n[밸런스] 소요 ${r.seconds}초 / 받은 피해 ${r.damageTaken} / 피격 ${r.playerHits}회 / 보스 TTK ${r.bossTtk}초`)
    }

    // 목표는 5~10분짜리 세로 슬라이스다. 지금이 그 근처인지 **숫자로** 남긴다.
    // 통과 기준은 일부러 느슨하게 뒀다 — 여기서 막히면 밸런스를 못 만진다.
    expect(r.seconds).toBeGreaterThan(10)
    expect(r.kills).toBeGreaterThan(5)
  })
})
