#!/usr/bin/env node
/**
 * 무리 어그로 계측 — "무리로 덤비는가"를 수치로 판정한다.
 *
 * 이 도구는 무리 어그로가 구현되기 **전에** 만들었다. 완료 조건을 구현 결과에 맞춰
 * 나중에 정하면 기준이 흔들리기 때문이다. 지금 돌리면 현재(개별 인지) 상태의
 * 기준선이 나오고, 구현 후 같은 명령으로 비교하면 된다.
 *
 *   node tools/playtest/aggrometer.mjs [최대초] [--headed] [--dump]
 *
 * 판정 항목
 *   교전 무리 크기   한 번의 교전에 동시에 참여한 적 수. 핵앤슬래시면 3 이상이어야 한다.
 *   각성 동시성      적이 깨어날 때 혼자 깨는가, 무리로 깨는가.
 *   원거리 오인 각성  플레이어에게서 멀리 떨어진 적이 깨는가. 벽 너머·다음 방 끌림 지표.
 *   각성 폭주        한 번에 대부분이 깨어나는가. 연쇄 반응 지표.
 */

import { GameSession } from "./core.mjs"

const BASE_URL = process.env.PLAYTEST_URL ?? "http://localhost:5173/"
const POLL = 1
/** 이 거리 밖에서 깨어나면 오인 각성으로 본다 (적 어그로 범위 최대 10 + 여유) */
const FAR_WAKE_DIST = 16
/** 각성이 이 시간 안에 몰리면 같은 무리가 함께 깬 것으로 본다 */
const WAKE_WINDOW = 1.0

async function collect({ headed, maxSeconds }) {
  const session = new GameSession()
  let series = []
  try {
    await session.start({ url: `${BASE_URL}?autoplay=1`, headed })
    await session.startAggroTrace()
    const started = Date.now()
    while ((Date.now() - started) / 1000 < maxSeconds) {
      const o = await session.wait(POLL)
      if (o.bossDefeated) break
    }
    series = await session.readAggroTrace()
  } finally {
    await session.close().catch(() => {})
  }
  return series
}

/** idle 이 아닌 상태로 처음 바뀐 순간을 '각성'으로 본다. */
function findWakeEvents(series) {
  const awake = new Map()
  const events = []
  for (const s of series) {
    for (const e of s.enemies) {
      const was = awake.get(e.id) ?? false
      const now = e.state !== "idle"
      if (now && !was) events.push({ t: s.t, id: e.id, dist: e.distToPlayer, total: s.enemies.length })
      awake.set(e.id, now)
    }
  }
  return events
}

/** 시간이 가까운 각성끼리 묶는다 — 함께 깬 무리로 본다. */
function groupWakes(events) {
  const groups = []
  for (const ev of events) {
    const last = groups[groups.length - 1]
    if (last && ev.t - last.lastT <= WAKE_WINDOW) {
      last.count++
      last.lastT = ev.t
      last.maxDist = Math.max(last.maxDist, ev.dist)
    } else {
      groups.push({ startT: ev.t, lastT: ev.t, count: 1, maxDist: ev.dist })
    }
  }
  return groups
}

function report(series) {
  if (series.length === 0) {
    console.log("표본이 없다. dev 서버와 자동 플레이 봇을 확인할 것.")
    return 1
  }
  const events = findWakeEvents(series)
  const groups = groupWakes(events)
  const totalEnemies = Math.max(...series.map((s) => s.enemies.length))

  const engaged = series.map((s) => s.enemies.filter((e) => e.state === "chase" || e.state === "attack").length)
  const fighting = engaged.filter((n) => n > 0)
  const avgPack = fighting.length ? +(fighting.reduce((a, b) => a + b, 0) / fighting.length).toFixed(1) : 0
  const maxPack = engaged.length ? Math.max(...engaged) : 0

  const soloWakes = groups.filter((g) => g.count === 1).length
  const packWakes = groups.filter((g) => g.count >= 3).length
  const farWakes = events.filter((e) => e.dist > FAR_WAKE_DIST).length
  const stampede = groups.filter((g) => g.count > totalEnemies * 0.5).length

  const L = []
  L.push("[무리 어그로 계측]")
  L.push(`표본 ${series.length} · 전체 적 ${totalEnemies} · 각성 ${events.length}회 (묶음 ${groups.length}개)`)
  L.push("")
  L.push(`교전 무리 크기    평균 ${avgPack} · 최대 ${maxPack}      ← 핵앤슬래시면 평균 3 이상`)
  L.push(`단독 각성         ${soloWakes}/${groups.length} 묶음        ← 낮을수록 무리로 반응한다는 뜻`)
  L.push(`무리 각성(3기 이상) ${packWakes}/${groups.length} 묶음`)
  L.push(`원거리 오인 각성   ${farWakes}회 (${FAR_WAKE_DIST} 밖)   ← 벽 너머·다음 방 끌림. 0이어야 한다`)
  L.push(`각성 폭주         ${stampede}회 (전체 절반 초과)  ← 연쇄 반응. 0이어야 한다`)
  L.push("")
  L.push("완료 기준: 평균 교전 무리 3 이상 · 원거리 오인 각성 0 · 각성 폭주 0")
  L.push("주의: 진행은 자동 플레이 봇이 맡으므로 절대 수치가 아니라 구현 전후 비교용 기준선이다.")
  console.log(L.join("\n"))

  if (process.argv.includes("--dump")) {
    console.log("\n각성 묶음")
    console.log("   시작    인원  최대거리")
    for (const g of groups) {
      console.log(`  ${String(g.startT).padStart(6)}  ${String(g.count).padStart(4)}  ${g.maxDist.toFixed(1).padStart(8)}`)
    }
  }

  const ok = avgPack >= 3 && farWakes === 0 && stampede === 0
  return ok ? 0 : 1
}

const args = process.argv.slice(2)
const maxSeconds = Number(args.find((a) => /^\d+$/.test(a)) ?? 120)
const series = await collect({ headed: args.includes("--headed"), maxSeconds })
process.exit(report(series))
