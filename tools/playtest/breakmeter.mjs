#!/usr/bin/env node
/**
 * 브레이크 계측 — 보스전이 "판단을 요구하는가"를 수치로 판정한다.
 *
 * 게이지가 존재한다는 것과 그 게이지가 재미있다는 것은 다른 문제다.
 * 플레이어가 아무것도 하지 않아도 브레이크가 나면 그건 연출이지 선택이 아니다.
 * 그 구분을 눈이 아니라 수치로 내리기 위한 도구다.
 *
 *   node tools/playtest/breakmeter.mjs [최대초] [--headed]
 *
 * 관측만 하고 게임 상태는 건드리지 않는다. 진행은 게임 내장 자동 플레이 봇에 맡긴다.
 * 봇의 스킬 사용 습관은 사람과 다르므로 절대 수치가 아니라 **변경 전후 비교용 기준선**으로 읽어야 한다.
 */

import { GameSession } from "./core.mjs"

const BASE_URL = process.env.PLAYTEST_URL ?? "http://localhost:5173/"
const POLL_INTERVAL = 1
const WHIRLWIND_COST = 25

/**
 * 페이지 안 추적기가 렌더 프레임마다 모은 시계열을 회수한다.
 * 바깥에서 observe() 로 폴링하면 0.8초짜리 창을 통째로 놓치기 때문에,
 * 진행 여부만 바깥에서 확인하고 실제 표본은 안에서 쌓는다.
 */
async function collect({ headed, maxSeconds }) {
  const session = new GameSession()
  let series = []
  let defeated = false
  try {
    await session.start({ url: `${BASE_URL}?autoplay=1`, headed })
    await session.startTrace()
    const started = Date.now()
    while ((Date.now() - started) / 1000 < maxSeconds) {
      const o = await session.wait(POLL_INTERVAL)
      if (o.bossDefeated) {
        defeated = true
        break
      }
    }
    series = await session.readTrace()
  } finally {
    await session.close().catch(() => {})
  }
  return { series, defeated }
}

/**
 * 시계열에서 노출 창을 잘라내고, 각 창에서 플레이어가 실제로 개입했는지 판정한다.
 * 개입 판정은 두 가지 흔적으로만 한다 — 분노 감소(회전베기)와 돌진 쿨다운 진입.
 * 둘 다 없는데 게이지가 깎였다면 그 창은 동료와 평타만으로 진행된 것이다.
 */
function analyzeWindows(series) {
  const windows = []
  let cur = null
  for (let i = 0; i < series.length; i++) {
    const s = series[i]
    const prev = series[i - 1]
    if (s.exposed && !cur) {
      cur = { startT: s.t, gaugeStart: s.gauge, gaugeMax: s.gaugeMax, samples: [s], brokeInWindow: false }
    } else if (s.exposed && cur) {
      cur.samples.push(s)
    } else if (!s.exposed && cur) {
      cur.endT = prev?.t ?? s.t
      cur.gaugeEnd = prev?.gauge ?? s.gauge
      // 창이 닫히는 순간 무력화로 넘어갔다면 그 창에서 브레이크가 난 것
      cur.brokeInWindow = !!s.broken
      windows.push(cur)
      cur = null
    }
  }
  if (cur) {
    cur.endT = cur.samples[cur.samples.length - 1].t
    cur.gaugeEnd = cur.samples[cur.samples.length - 1].gauge
    windows.push(cur)
  }

  for (const w of windows) {
    let rageSpent = false
    let dashUsed = false
    for (let i = 1; i < w.samples.length; i++) {
      // 분노를 소모하는 것은 회전베기뿐이므로 "감소했다"는 사실 자체가 시전 신호다.
      // 동료 타격이 같은 프레임에 분노를 채워 넣기 때문에 감소폭으로 판정하면 놓친다.
      // 단, 사망 시 분노가 0으로 초기화되므로 그 구간은 제외한다.
      const died = w.samples[i].playerDead || w.samples[i - 1].playerDead
      if (!died && w.samples[i].rage < w.samples[i - 1].rage) rageSpent = true
      if (w.samples[i - 1].dashReady && !w.samples[i].dashReady) dashUsed = true
    }
    w.playerIntervened = rageSpent || dashUsed
    w.gaugeDrain = (w.gaugeStart ?? 0) - (w.gaugeEnd ?? 0)
    w.carriedOver = w.gaugeStart !== null && w.gaugeMax !== null && w.gaugeStart < w.gaugeMax
    w.duration = w.endT - w.startT
  }
  return windows
}

/** 돌진을 브레이크 창에 썼는지, 단순 이동에 썼는지 가른다. */
function analyzeDash(series) {
  let forBreak = 0
  let forMobility = 0
  for (let i = 1; i < series.length; i++) {
    if (series[i - 1].dashReady && !series[i].dashReady) {
      if (series[i].anyExposed || series[i - 1].anyExposed) forBreak++
      else forMobility++
    }
  }
  return { forBreak, forMobility, total: forBreak + forMobility }
}

function analyzeRage(fight) {
  if (fight.length === 0) return null
  const rages = fight.map((s) => s.rage)
  const below = rages.filter((r) => r < WHIRLWIND_COST).length
  return {
    mean: Math.round(rages.reduce((a, b) => a + b, 0) / rages.length),
    min: Math.min(...rages),
    max: Math.max(...rages),
    starvedPct: Math.round((below / rages.length) * 100),
  }
}

function pct(n, d) {
  return d === 0 ? "—" : `${Math.round((n / d) * 100)}%`
}

function report({ series, defeated }) {
  const withBoss = series.filter((s) => s.gauge !== null)
  if (withBoss.length === 0) {
    console.log("보스를 만나지 못했습니다. 최대 시간을 늘리거나 자동 플레이 봇 동선을 확인하세요.")
    return 1
  }

  // 실제 교전 구간: 보스가 첫 피해를 입은 시점부터
  const firstHit = withBoss.findIndex((s) => s.bossHp < s.bossMaxHp)
  const fight = firstHit >= 0 ? withBoss.slice(firstHit) : withBoss
  const fightSeconds = fight.length > 1 ? +(fight[fight.length - 1].t - fight[0].t).toFixed(1) : 0

  const windows = analyzeWindows(withBoss)
  const breaks = windows.filter((w) => w.brokeInWindow).length
  const carried = windows.filter((w) => w.carriedOver).length
  const passiveWindows = windows.filter((w) => !w.playerIntervened && w.gaugeDrain > 0).length
  const passiveBreaks = windows.filter((w) => w.brokeInWindow && !w.playerIntervened).length
  const dash = analyzeDash(withBoss)
  const rage = analyzeRage(fight)
  const exposedSeconds = +windows.reduce((a, w) => a + w.duration, 0).toFixed(1)
  const avgWindow = windows.length ? +(exposedSeconds / windows.length).toFixed(2) : 0

  const L = []
  L.push("[브레이크 계측]")
  L.push(`보스 교전 ${fightSeconds}초 · ${defeated ? "처치 성공" : "미처치(시간 초과)"}`)
  L.push("")
  L.push(`노출 창          ${windows.length}회 (총 ${exposedSeconds}초, 평균 ${avgWindow}초)`)
  L.push(`브레이크         ${breaks}회`)
  L.push(`창당 브레이크율  ${pct(breaks, windows.length)}`)
  L.push("")
  L.push(`게이지 이월      ${carried}/${windows.length}창 — 창이 열릴 때 이미 깎여 있던 횟수`)
  L.push(`                 이월이 잦으면 "이번 창에 넣어야 한다"는 압박이 사라진다`)
  L.push("")
  L.push(`무개입 진행 창   ${passiveWindows}회 (${pct(passiveWindows, windows.length)}) — 분노 소모도 돌진도 없이 게이지가 깎인 창`)
  L.push(`무개입 브레이크  ${passiveBreaks}회  ← 0이 아니면 브레이크가 자동화되고 있다는 뜻`)
  L.push("")
  L.push(`돌진 사용        ${dash.total}회 (브레이크 창 중 ${dash.forBreak} / 이동용 ${dash.forMobility})`)
  if (rage) {
    L.push(`분노             평균 ${rage.mean} · 최저 ${rage.min} · 부족(25 미만)이었던 시간 ${rage.starvedPct}%`)
    L.push(`                 계속 가득 차 있으면 회전베기는 비용 없는 스킬이 된다`)
  }
  L.push("")
  L.push("판정 기준: 무개입 브레이크 0회 · 창당 브레이크율 40~70% · 분노 부족 시간 20% 이상")
  L.push("주의: 진행은 자동 플레이 봇이 맡으므로 절대 수치가 아니라 변경 전후 비교용 기준선이다.")
  console.log(L.join("\n"))

  if (windows.length > 0) {
    console.log(`\n창별 상세 (게이지 최대 ${windows[0].gaugeMax})`)
    console.log("  #   시작    길이   게이지         이월  개입  브레이크")
    windows.forEach((w, i) => {
      const g = `${String(w.gaugeStart).padStart(3)}→${String(w.gaugeEnd).padStart(3)}`
      console.log(
        `  ${String(i + 1).padStart(2)}  ${String(w.startT).padStart(6)}  ${w.duration.toFixed(2).padStart(5)}  ${g.padEnd(12)}  ${w.carriedOver ? " O " : " . "}   ${w.playerIntervened ? " O " : " . "}   ${w.brokeInWindow ? "O" : "."}`,
      )
    })
  }
  return passiveBreaks > 0 ? 1 : 0
}

/** 게이지나 노출 상태가 바뀐 순간만 골라 원시 표본을 보여준다. 계측이 이상할 때 쓴다. */
function dump(series) {
  console.log("\n[원시 추적 — 변화 지점만]")
  console.log("  t       게이지  노출 무력화 보스HP 분노 돌진")
  let prev = null
  for (const s of series) {
    if (s.gauge === null) continue
    const changed =
      !prev ||
      s.gauge !== prev.gauge ||
      s.exposed !== prev.exposed ||
      s.broken !== prev.broken ||
      s.bossHp !== prev.bossHp
    if (changed) {
      console.log(
        `  ${String(s.t).padStart(7)} ${String(s.gauge).padStart(6)}  ${s.exposed ? "O" : "."}    ${s.broken ? "O" : "."}    ${String(s.bossHp).padStart(5)} ${String(s.rage).padStart(4)} ${s.dashReady ? "O" : "."}`,
      )
    }
    prev = s
  }
}

const args = process.argv.slice(2)
const maxSeconds = Number(args.find((a) => /^\d+$/.test(a)) ?? 180)
const headed = args.includes("--headed")

const data = await collect({ headed, maxSeconds })
const code = report(data)
if (args.includes("--dump")) dump(data.series)
process.exit(code)
