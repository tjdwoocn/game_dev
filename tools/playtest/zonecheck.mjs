#!/usr/bin/env node
/**
 * 존 전환 검증 — 모든 존을 실제로 들어가 보고 기능이 성립하는지 확인한다.
 *
 * 지금까지 내 맵 7개는 존 시스템이 없어 브라우저로 열어 본 적이 없었다.
 * 격자 검증(tests/maps.functional.test.ts)은 통과했지만 그건 엔진 함수를 돌린 것이고,
 * 실제로 로드되어 렌더되는지는 다른 문제다.
 *
 *   node tools/playtest/zonecheck.mjs [--headed]
 *
 * 전환은 `__game.transitionTo(zoneId)` 로 한다. 게임 내 이동 수단(문지기 NPC·출구 타일)이
 * 아직 없어서인데, 존 로딩 경로 자체는 실제와 동일하다. 진입 트리거가 생기면
 * 그쪽으로 바꾼다.
 */

import { GameSession } from "./core.mjs"

const BASE_URL = process.env.PLAYTEST_URL ?? "http://localhost:5173/"

/** 각 존에서 기대하는 것. 마을은 전투가 없어야 하고, 보스방에는 보스가 있어야 한다. */
const EXPECTED = {
  town: { kind: "town", enemies: "none" },
  mine: { kind: "field", enemies: "some" },
  hall: { kind: "field", enemies: "some" },
  catacomb: { kind: "field", enemies: "some" },
  bridge: { kind: "field", enemies: "some" },
  throne: { kind: "boss", enemies: "boss" },
  cistern: { kind: "boss", enemies: "boss" },
  crucible: { kind: "boss", enemies: "boss" },
}

const TILE = 2

const results = []
function rec(zone, name, passed, detail) {
  results.push({ zone, name, passed })
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${zone.padEnd(9)} ${name.padEnd(26)} ${detail}`)
}

const session = new GameSession()
try {
  let o = await session.start({ url: BASE_URL, headed: process.argv.includes("--headed") })
  console.log("[존 전환 검증]")
  console.log(`시작 존: ${o.zoneId} · 맵 ${o.map.cols}×${o.map.rows}\n`)

  // 진행 상태가 전환 후에도 유지되는지 보기 위해 기준값을 잡아 둔다
  const baseline = { level: o.player.level, inventory: o.player.inventory.length }

  const zoneIds = Object.keys(EXPECTED)
  let prevZone = o.zoneId

  for (const zoneId of zoneIds) {
    const spec = EXPECTED[zoneId]
    await session.page.evaluate(`__game.transitionTo(${JSON.stringify(zoneId)})`)
    o = await session.wait(1.5)

    rec(zoneId, "존 ID가 바뀐다", o.zoneId === zoneId, `${prevZone} → ${o.zoneId}`)
    rec(zoneId, "맵이 로드된다", o.map.cols > 0 && o.map.rows > 0, `${o.map.cols}×${o.map.rows}`)
    rec(zoneId, "플레이어가 화면에 보인다", o.player.screen.onScreen, `(${o.player.world.x}, ${o.player.world.z})`)
    rec(zoneId, "플레이어가 살아있다", !o.player.dead, `HP ${o.player.hp}/${o.player.maxHp}`)

    const enemies = o.enemies.length
    const hasBoss = o.enemies.some((e) => e.isBoss)
    if (spec.enemies === "none") {
      rec(zoneId, "전투가 없다", enemies === 0, `적 ${enemies}`)
    } else if (spec.enemies === "boss") {
      rec(zoneId, "보스가 있다", hasBoss, `적 ${enemies} (보스 ${hasBoss ? "있음" : "없음"})`)
    } else {
      rec(zoneId, "적이 배치된다", enemies > 0, `적 ${enemies}`)
    }

    // 이전 존의 적이 남았는지는 좌표 겹침이 아니라 **맵 경계 이탈**로 본다.
    // 좌표가 겹치는 것은 서로 다른 맵에서 우연히 같은 칸에 배치됐을 수 있어 오탐이 난다.
    const outOfBounds = o.enemies.filter(
      (e) => e.world.x < 0 || e.world.z < 0 || e.world.x > o.map.cols * TILE || e.world.z > o.map.rows * TILE,
    ).length
    rec(zoneId, "이전 존 잔재가 없다", outOfBounds === 0, `맵 밖 적 ${outOfBounds}`)

    rec(
      zoneId,
      "진행 상태가 유지된다",
      o.player.level >= baseline.level && o.player.inventory.length >= baseline.inventory,
      `Lv${o.player.level} · 인벤 ${o.player.inventory.length}`,
    )
    rec(zoneId, "콘솔 에러 없음", o.consoleErrors.length === 0, `에러 ${o.consoleErrors.length}`)

    prevZone = zoneId
    console.log("")
  }

  // 마을로 되돌아오는 왕복까지 확인한다
  await session.page.evaluate(`__game.transitionTo("town")`)
  o = await session.wait(1.5)
  rec("town", "왕복 복귀", o.zoneId === "town" && o.enemies.length === 0, `적 ${o.enemies.length}`)
} finally {
  await session.close().catch(() => {})
}

const passed = results.filter((r) => r.passed).length
const failedZones = [...new Set(results.filter((r) => !r.passed).map((r) => r.zone))]
console.log(`\n통과 ${passed}/${results.length}`)
if (failedZones.length > 0) console.log(`문제 있는 존: ${failedZones.join(", ")}`)
process.exit(passed === results.length ? 0 : 1)
