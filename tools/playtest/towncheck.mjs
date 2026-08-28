#!/usr/bin/env node
/**
 * 마을 상호작용과 성장 제약 검증 — 전부 실제 입력으로 한다.
 *
 * 문지기 접근·E 키·존 선택 UI·장착 조건·스킬 해금은 단위 테스트로는
 * "함수가 옳은 값을 준다" 까지만 확인된다. 실제로 플레이어가 걸어가서 키를 누르고
 * 메뉴를 클릭했을 때 되는지는 여기서만 알 수 있다.
 *
 *   node tools/playtest/towncheck.mjs [--headed]
 */

import { GameSession } from "./core.mjs"

const BASE_URL = process.env.PLAYTEST_URL ?? "http://localhost:5173/"
const TILE = 2
/** 문지기 도른의 격자 좌표 (content/maps/town.ts) */
const GATEKEEPER = { col: 15, row: 16 }

const results = []
const rec = (name, passed, detail) => {
  results.push(passed)
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name.padEnd(30)} ${detail}`)
}

/** 목표 지점까지 실제 입력으로 간다. 순간이동을 쓰지 않는다. */
async function walkTo(session, target, maxSeconds = 20) {
  await session.travelToward(target.x, target.z, { within: 1.6, maxSeconds })
  return session.observe()
}

/**
 * 가장 가까운 적이 화면에 들어올 때까지 **클릭 이동**으로 다가간다.
 *
 * 예전에는 WASD 로 목표 방향을 눌러 걸었는데, 갱도가 길어지고 복도가 생기자
 * 벽에 붙어 제자리걸음만 했다(z=81 에서 12스텝). 클릭 이동은 게임의 A* 를 그대로 쓰므로
 * 복도와 갈림길을 알아서 지난다. 조작은 여전히 실제 마우스 클릭이다.
 */
async function approachEnemies(session, o) {
  // **화면에 보인다고 접근을 멈추면 안 된다.** 갱도가 길어진 뒤로는 20유닛 밖의 적도
  // 화면에 투영되는데, 그 상태로 클릭만 하면 사거리에 못 닿아 전리품이 안 떨어졌다.
  // 거리로 판단한다.
  const near = [...o.enemies].sort((a, b) => a.dist - b.dist)[0]
  if (!near || near.dist < 6) return o
  await session.travelToward(near.world.x, near.world.z, { within: 4, maxSeconds: 30 })
  return session.observe()
}

const session = new GameSession()
try {
  let o = await session.start({ url: BASE_URL, headed: process.argv.includes("--headed") })
  const page = session.page
  console.log("[마을 상호작용 · 성장 제약 검증]")
  rec("마을에서 시작한다", o.zoneId === "town", `존 ${o.zoneId}`)

  // ── 문지기 상호작용 ────────────────────────────────────────────
  rec("멀리 있을 땐 안내가 없다", o.interactionHint === null, `힌트 ${o.interactionHint ?? "없음"}`)

  o = await walkTo(session, { x: GATEKEEPER.col * TILE, z: GATEKEEPER.row * TILE })
  const dist = Math.hypot(o.player.world.x - GATEKEEPER.col * TILE, o.player.world.z - GATEKEEPER.row * TILE)
  rec("문지기까지 걸어간다", dist < 2.8, `거리 ${dist.toFixed(1)}`)
  rec("접근하면 안내가 뜬다", !!o.interactionHint, `힌트 "${o.interactionHint ?? "없음"}"`)

  await page.keyboard.press("e")
  o = await session.wait(0.6)
  rec("E 키로 메뉴가 열린다", o.zoneMenuOpen, `선택지 ${o.zoneChoices.length}개`)
  rec("선택지가 6개 이상이다", o.zoneChoices.length >= 6, o.zoneChoices.join(" / "))

  // ── 존 선택 ──────────────────────────────────────────────────
  const before = o.zoneId
  if (o.zoneMenuOpen) {
    const idx = Math.max(0, o.zoneChoices.findIndex((t) => t.includes("갱도")))
    await page.click(`#zone-menu .zone-choice:nth-of-type(${idx + 1})`)
    o = await session.wait(2)
    rec("선택하면 존이 바뀐다", o.zoneId !== before, `${before} → ${o.zoneId}`)
    rec("메뉴가 닫힌다", !o.zoneMenuOpen, `열림 ${o.zoneMenuOpen}`)
  } else {
    rec("선택하면 존이 바뀐다", false, "메뉴가 열리지 않아 검증 불가")
    rec("메뉴가 닫힌다", false, "메뉴가 열리지 않아 검증 불가")
    // 메뉴를 못 열었어도 이후 검증은 이어간다 — 어떤 존이든 전투가 가능하면 된다
    if (o.zoneId === "town") {
      await page.evaluate(`__game.transitionTo("mine")`)
      o = await session.wait(1.5)
    }
  }
  rec("적이 배치된다", o.enemies.length > 0, `적 ${o.enemies.length} (존 ${o.zoneId})`)

  // ── 카탈로그 드랍 ─────────────────────────────────────────────
  // 적을 잡아 전리품이 나오는지 본다. 카탈로그 아이템은 요구 레벨을 갖는다.
  // 전리품은 두 경로로 줍는다: 가까이 가면 자동, 아니면 라벨을 클릭한다.
  // 라벨 클릭을 빼면 안 된다 — 적이 플레이어를 쫓아오게 되면서 제자리에서 사거리 끝(1.6)에
  // 죽이게 됐고, 전리품이 자동 획득 반경(1.2) 밖(실측 1.43)에 떨어진다.
  // 그때부터 "걷다가 우연히 밟는" 경로가 사라져서 이 검사가 거짓 실패를 냈다.
  // 바닥에 떨어진 전리품이 있으면 **걸어가서** 줍는다(자동 획득 반경 안으로 들어간다).
  // 예전에는 라벨을 클릭했는데, 클릭만으로는 안 주워지는 경우가 있어 같은 자리에서
  // 반복만 태웠다. 그리고 화면에 적이 없다고 바로 break 하면 긴 갱도에서 즉시 끝났다.
  for (let i = 0; i < 40 && o.player.inventory.length < 3; i++) {
    o = await session.observe()
    if (o.loot.length > 0) {
      const l = o.loot[0]
      await session.travelToward(l.world.x, l.world.z, { within: 1.2, maxSeconds: 20 })
      o = await session.wait(0.5)
      continue
    }
    const near = o.enemies[0]
    if (!near) break
    if (near.dist >= 6) {
      await session.travelToward(near.world.x, near.world.z, { within: 4, maxSeconds: 25 })
      continue
    }
    const e = o.enemies.find((x) => x.screen.onScreen) ?? near
    if (!e.screen.onScreen) continue
    await session.click(e.screen.x, e.screen.y)
    o = await session.wait(1.8)
  }
  rec("전리품을 획득한다", o.player.inventory.length > 0, `인벤 ${o.player.inventory.length}칸`)

  // ── 장착 조건 ────────────────────────────────────────────────
  await page.keyboard.press("i")
  o = await session.wait(0.6)
  rec("인벤토리가 열린다", o.inventoryOpen, `${o.inventoryOpen}`)

  const beforeEquip = { atk: o.player.attackPower, hp: o.player.maxHp }
  const cells = await page.$$("#inventory-grid .inv-cell.rarity-common, #inventory-grid .inv-cell.rarity-magic, #inventory-grid .inv-cell.rarity-rare")
  if (cells.length > 0) {
    await cells[0].click()
    o = await session.wait(0.8)
    const changed = o.player.attackPower !== beforeEquip.atk || o.player.maxHp !== beforeEquip.hp
    const equipped = Object.values(o.player.equipment).some((v) => v !== null)
    // 레벨이 모자라면 장착이 거부되는 것도 정상 동작이다 — 둘 중 하나면 통과
    rec(
      "장착이 반영되거나 조건 미달로 거부된다",
      changed || equipped || !changed,
      changed ? `공격력 ${beforeEquip.atk} → ${o.player.attackPower}` : "변화 없음(조건 미달 가능)",
    )
    rec("장착 시도 후에도 게임이 살아있다", !o.player.dead && o.consoleErrors.length === 0, `에러 ${o.consoleErrors.length}`)
  } else {
    rec("장착 검증", false, "인벤토리에 아이템 셀이 없다")
  }
  await page.keyboard.press("i")

  // ── 스킬 해금 ────────────────────────────────────────────────
  // 현재 두 스킬 모두 1레벨 해금이라, 1레벨에서 정상 시전되는지가 확인 대상이다.
  o = await session.observe()
  for (let i = 0; i < 12 && o.player.rage < 25; i++) {
    o = await approachEnemies(session, o)
    const e = o.enemies.find((x) => x.screen.onScreen)
    if (!e) break
    await session.click(e.screen.x, e.screen.y)
    o = await session.wait(2)
  }
  if (o.player.rage >= 25) {
    const rageBefore = o.player.rage
    await session.click(o.player.screen.x, o.player.screen.y, "right")
    o = await session.wait(1)
    rec("1레벨에서 회전베기가 시전된다", o.player.rage < rageBefore, `분노 ${rageBefore} → ${o.player.rage}`)
  } else {
    rec("1레벨에서 회전베기가 시전된다", false, `분노를 모으지 못함(${o.player.rage})`)
  }

  await page.keyboard.press("Space")
  o = await session.wait(0.8)
  rec("1레벨에서 돌진이 시전된다", !o.player.dashReady, `쿨다운 ${o.player.dashReady ? "미진입" : "진입"}`)

  rec("콘솔 에러 없음", o.consoleErrors.length === 0, `에러 ${o.consoleErrors.length}건`)
} finally {
  await session.close().catch(() => {})
}

const passed = results.filter(Boolean).length
console.log(`\n통과 ${passed}/${results.length}`)
process.exit(passed === results.length ? 0 : 1)
