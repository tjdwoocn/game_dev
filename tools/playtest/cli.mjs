#!/usr/bin/env node
/**
 * 플레이테스트 CLI.
 *
 *   node tools/playtest/cli.mjs autorun            자동 플레이 봇으로 던전 완주 + 체크포인트 리포트
 *   node tools/playtest/cli.mjs start [--headed]   상주 세션 시작 (server.mjs 가 떠 있어야 함)
 *   node tools/playtest/cli.mjs observe            현재 상태 관측 (JSON)
 *   node tools/playtest/cli.mjs click <x> <y> [right]
 *   node tools/playtest/cli.mjs press <Key>
 *   node tools/playtest/cli.mjs wait <seconds>
 *   node tools/playtest/cli.mjs shot <path>
 *
 * 기본은 헤드리스다. 조작은 언제나 실제 마우스/키 입력으로만 이뤄진다.
 */

import { GameSession } from "./core.mjs"
import { createTracker, formatReport } from "./scenario.mjs"

const PORT = Number(process.env.PLAYTEST_PORT ?? 7391)
const BASE_URL = process.env.PLAYTEST_URL ?? "http://localhost:5173/"

async function call(route, args = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
  })
  const json = await res.json()
  if (json.error) throw new Error(json.error)
  return json
}

/** 자동 플레이 봇을 켜고 끝까지 돌린 뒤 체크포인트로 판정한다. */
async function autorun({ headed, timeoutSec, shotPath }) {
  const session = new GameSession()
  const tracker = createTracker()
  const started = Date.now()
  let last = null
  try {
    last = await session.start({ url: `${BASE_URL}?autoplay=1`, headed })
    tracker.update(last)

    // 첫 이동 확인용: 봇이 움직이기 전 위치를 기준점으로 잡는다
    while ((Date.now() - started) / 1000 < timeoutSec) {
      last = await session.wait(0.5)
      tracker.update(last)
      if (last.bossDefeated) break
    }
    if (shotPath) await session.screenshot(shotPath)
  } finally {
    await session.close().catch(() => {})
  }
  const elapsed = Math.round((Date.now() - started) / 1000)
  const results = tracker.evaluate(last ?? { ready: false })
  console.log(formatReport(results, tracker.ctx, elapsed))
  const failedObjectives = results.filter((r) => !r.passed && r.tier === "objective")
  process.exit(failedObjectives.length > 0 ? 1 : 0)
}

/**
 * 실제 마우스/키 입력만으로 조작이 되는지 검증한다.
 * autorun 은 게임 내부 봇이 돌리므로 입력 경로를 타지 않는다 — 이쪽이 그 빈틈을 메운다.
 */
async function inputcheck({ headed }) {
  const session = new GameSession()
  const checks = []
  const record = (name, passed, detail) => {
    checks.push({ name, passed, detail })
    console.log(`  ${passed ? "PASS" : "FAIL"}  ${name.padEnd(22)} ${detail}`)
  }

  try {
    let o = await session.start({ url: BASE_URL, headed })
    console.log("[실제 입력 검증]")

    // 1) 좌클릭 이동
    const before = { ...o.player.world }
    await session.click(o.player.screen.x, Math.max(40, o.player.screen.y - 140))
    o = await session.wait(2)
    const movedDist = Math.hypot(o.player.world.x - before.x, o.player.world.z - before.z)
    record("좌클릭 이동", movedDist > 1.5, `이동 거리 ${movedDist.toFixed(1)}`)

    // 2) 적 클릭 → 접근 후 기본 공격 (분노가 차오르면 명중한 것)
    let target = o.enemies.find((e) => e.screen.onScreen && !e.isBoss)
    if (!target) {
      // 적이 화면에 없으면 가장 가까운 적 쪽으로 몇 번 이동해 접근한다
      for (let i = 0; i < 6 && !target; i++) {
        const nearest = o.enemies[0]
        if (!nearest) break
        const dx = nearest.screen.x - o.player.screen.x
        const dy = nearest.screen.y - o.player.screen.y
        const len = Math.hypot(dx, dy) || 1
        await session.click(
          Math.round(o.player.screen.x + (dx / len) * 200),
          Math.round(o.player.screen.y + (dy / len) * 200),
        )
        o = await session.wait(2)
        target = o.enemies.find((e) => e.screen.onScreen && !e.isBoss)
      }
    }
    if (target) {
      const hpBefore = target.hp
      await session.click(target.screen.x, target.screen.y)
      o = await session.wait(3)
      const after = o.enemies.find((e) => e.world.x === target.world.x && e.world.z === target.world.z)
      const damaged = !after || after.hp < hpBefore || o.player.rage > 0
      record("적 클릭 공격", damaged, after ? `적 HP ${hpBefore} → ${after.hp}, 분노 ${o.player.rage}` : "적 처치됨")
    } else {
      record("적 클릭 공격", false, "화면에서 적을 찾지 못함")
    }

    // 3) 우클릭 회전베기 — 분노가 모일 때까지 싸운 뒤 시전한다
    for (let i = 0; i < 8 && o.player.rage < 25; i++) {
      const next = o.enemies.find((e) => e.screen.onScreen && !e.isBoss) ?? o.enemies[0]
      if (!next) break
      await session.click(next.screen.x, next.screen.y)
      o = await session.wait(2)
    }
    if (o.player.rage >= 25) {
      const rageBefore = o.player.rage
      await session.click(o.player.screen.x, o.player.screen.y, "right")
      o = await session.wait(1)
      record("우클릭 회전베기", o.player.rage < rageBefore, `분노 ${rageBefore} → ${o.player.rage}`)
    } else {
      record("우클릭 회전베기", false, `분노를 25까지 모으지 못함(${o.player.rage})`)
    }

    // 4) Space 돌진 (쿨다운 진입)
    await session.moveMouse(o.player.screen.x, Math.max(40, o.player.screen.y - 150))
    await session.press("Space")
    o = await session.wait(1)
    record("Space 돌진", !o.player.dashReady, `돌진 쿨다운 ${o.player.dashReady ? "미진입" : "진입"}`)

    // 5) I 인벤토리 토글
    const invBefore = o.inventoryOpen
    await session.press("KeyI")
    o = await session.wait(1)
    record("I 인벤토리 토글", o.inventoryOpen !== invBefore, `${invBefore} → ${o.inventoryOpen}`)

    record("콘솔 에러 없음", o.consoleErrors.length === 0, `에러 ${o.consoleErrors.length}건`)
  } finally {
    await session.close().catch(() => {})
  }

  const passed = checks.filter((c) => c.passed).length
  console.log(`\n통과 ${passed}/${checks.length}`)
  process.exit(passed === checks.length ? 0 : 1)
}

const [, , cmd, ...rest] = process.argv
const flag = (name) => rest.includes(name)

try {
  switch (cmd) {
    case "autorun":
      await autorun({
        headed: flag("--headed"),
        timeoutSec: Number(rest.find((a) => /^\d+$/.test(a)) ?? 180),
        shotPath: rest[rest.indexOf("--shot") + 1] && flag("--shot") ? rest[rest.indexOf("--shot") + 1] : null,
      })
      break
    case "inputcheck":
      await inputcheck({ headed: flag("--headed") })
      break
    case "start":
      console.log(JSON.stringify(await call("/start", {
        url: flag("--autoplay") ? `${BASE_URL}?autoplay=1` : BASE_URL,
        headed: flag("--headed"),
      }), null, 2))
      break
    case "observe":
      console.log(JSON.stringify(await call("/observe"), null, 2))
      break
    case "click":
      console.log(JSON.stringify(await call("/click", {
        x: Number(rest[0]), y: Number(rest[1]), button: rest[2] === "right" ? "right" : "left",
      })))
      break
    case "press":
      console.log(JSON.stringify(await call("/press", { key: rest[0] })))
      break
    case "mouse":
      console.log(JSON.stringify(await call("/mouse", { x: Number(rest[0]), y: Number(rest[1]) })))
      break
    case "wait":
      console.log(JSON.stringify(await call("/wait", { seconds: Number(rest[0] ?? 1) }), null, 2))
      break
    case "shot":
      console.log(JSON.stringify(await call("/screenshot", { path: rest[0] })))
      break
    case "reload":
      console.log(JSON.stringify(await call("/reload", {
        url: flag("--autoplay") ? `${BASE_URL}?autoplay=1` : BASE_URL,
      }), null, 2))
      break
    default:
      console.error("사용법: autorun | inputcheck | start | observe | click | press | mouse | wait | shot | reload")
      process.exit(2)
  }
} catch (err) {
  console.error("오류:", err.message)
  process.exit(1)
}
