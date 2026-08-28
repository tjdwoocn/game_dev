#!/usr/bin/env node
/**
 * 스크린샷 계약 — **이름 붙은 결정적 뷰**와 대조 시트(contact sheet).
 *
 * 참고한 레퍼런스(Claude of Tanks)는 이걸 필수 인프라로 둔다:
 *   "The same run is reviewed in contact sheets before any frame becomes a 4K master"
 * 곡선 점수만 보고 출하했다가 **앞뒤가 뒤집힌 전차**가 나간 사고가 있었고, 그 뒤로
 * 눈으로 보는 대조가 의무가 됐다. 숫자로는 절대 못 잡는 종류의 결함이 있다.
 *
 * 우리도 같은 문제가 있었다. 이번 세션에서만 일회용 스크린샷 스크립트를 열 개 넘게 썼고,
 * 매번 새로 짜느라 **어제 화면과 오늘 화면을 나란히 놓고 본 적이 없다.**
 *
 * ## 무엇이 "계약" 인가
 *
 *  1. **이름**이 있다. `mine_corridor` 는 언제 찍어도 같은 곳이다.
 *  2. **결정적**이다. `?seed=` 로 난수를, `?quality=` 로 렌더 티어를 고정하고,
 *     같은 경로로 같은 지점까지 간다. 둘 중 하나라도 흔들리면 시트를 비교할 수 없다.
 *  3. **한 장으로 모인다.** 대조 시트가 있어야 "전보다 나아졌나" 를 판단할 수 있다.
 *
 * ## 쓰는 법
 *
 *   npm run shots                 # 전부 찍고 contact-sheet.png 를 만든다
 *   npm run shots -- --only=boss  # 이름에 boss 가 든 뷰만
 */

import { GameSession } from "./core.mjs"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? "playtest-out/shots"
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7) ?? null
const SEED = process.argv.find((a) => a.startsWith("--seed="))?.slice(7) ?? "20260828"
const BASE = process.env.PLAYTEST_URL ?? "http://localhost:5173/"
/**
 * **티어를 고정한다.** 품질 자동 감지(systems/quality.ts)는 GPU 에 따라 해상도·그림자·
 * 블룸을 바꾸므로, 고정하지 않으면 다른 기기에서 찍은 시트끼리 비교가 무의미해진다.
 * 티어별 비교 샷이 필요하면 --quality=low 처럼 명시한다.
 */
const QUALITY = process.argv.find((a) => a.startsWith("--quality="))?.slice(10) ?? "high"
/** 이미 찍어 둔 낱장으로 대조 시트만 다시 만든다. 시트 조판을 손볼 때 4분을 아낀다. */
const SHEET_ONLY = process.argv.includes("--sheet-only")

const TILE = 2
const GATE = { col: 15, row: 16 }

mkdirSync(OUT, { recursive: true })

/** 갱도로 들어간다. 거의 모든 뷰가 이걸 먼저 한다. */
async function enterMine(s) {
  let o = await s.observe()
  await s.travelToward(GATE.col * TILE, GATE.row * TILE, { within: 1.6 })
  await s.page.keyboard.press("e")
  o = await s.wait(0.7)
  const idx = Math.max(0, o.zoneChoices.findIndex((t) => t.includes("갱도")))
  await s.page.click(`#zone-menu .zone-choice:nth-of-type(${idx + 1})`)
  return s.wait(2.2)
}

/** 잡몹과 싸우지 않고 북쪽으로 z 까지 간다. */
async function pushNorth(s, z) {
  for (let i = 0; i < 24; i++) {
    const o = await s.observe()
    if (o.player.world.z <= z) return o
    await s.travelToward(o.player.world.x, Math.max(z - 1, o.player.world.z - 12), { within: 3, maxSeconds: 18 })
  }
  return s.observe()
}

/** 화면에 보이는 적을 한 마리 친다. 전투 장면용. */
async function engageNearest(s, seconds = 1.4) {
  const o = await s.observe()
  const e = o.enemies.find((x) => x.screen.onScreen && !x.isBoss)
  if (!e) return o
  await s.click(e.screen.x, e.screen.y)
  return s.wait(seconds)
}

/**
 * 뷰 목록.
 *
 * 고르는 기준: **무엇이 망가졌는지 이 한 장으로 알 수 있는가.**
 * 예쁜 장면이 아니라 진단이 되는 장면을 고른다.
 */
const VIEWS = [
  {
    name: "town",
    what: "마을 · 문지기 · NPC · 소품 · 그림자",
    async run(s) {
      await s.travelToward(GATE.col * TILE, GATE.row * TILE, { within: 2.4 })
      await s.wait(0.6)
    },
  },
  {
    name: "town_panels",
    what: "상태창 · 스킬창 · 미니맵",
    async run(s) {
      await s.travelToward(GATE.col * TILE, GATE.row * TILE, { within: 2.4 })
      await s.page.keyboard.press("c")
      await s.page.keyboard.press("k")
      await s.wait(0.6)
    },
  },
  {
    name: "mine_entry",
    what: "갱도 입구 방 · 벽 속 · 바닥 · 안개",
    async run(s) {
      await enterMine(s)
      await s.wait(0.6)
    },
  },
  {
    name: "mine_props",
    what: "복도 소품 배치 · 벽 그림자",
    async run(s) {
      await enterMine(s)
      await pushNorth(s, 80)
      await s.wait(0.6)
    },
  },
  {
    name: "mine_combat",
    what: "전투 · 적 실루엣 3종 · 타격 이펙트 · 바닥 자국",
    async run(s) {
      await enterMine(s)
      await pushNorth(s, 70)
      for (let i = 0; i < 3; i++) await engageNearest(s)
      await s.wait(0.3)
    },
  },
  {
    name: "mine_loot",
    what: "전리품 형태(검·갑옷·반지) · 등급 색",
    async run(s) {
      await enterMine(s)
      await pushNorth(s, 70)
      for (let i = 0; i < 6; i++) {
        const o = await engageNearest(s)
        if (o.loot.length >= 2) break
      }
      await s.wait(0.4)
    },
  },
  {
    name: "map_full",
    what: "전체 지도 · 방 모양 · 보스/정예 표시",
    async run(s) {
      await enterMine(s)
      await pushNorth(s, 70)
      await s.page.keyboard.press("m")
      await s.wait(0.5)
    },
  },
  {
    name: "boss_telegraph",
    what: "보스 · 패턴 예고 가독성 · 브레이크 게이지",
    async run(s) {
      await enterMine(s)
      await pushNorth(s, 12)
      // 예고가 뜰 때까지 기다렸다 잡는다
      for (let i = 0; i < 30; i++) {
        const phase = await s.page.evaluate(
          '(() => { const e = [...window.__game.world.with("boss")][0]; return e ? e.boss.phase : null })()',
        )
        if (phase && phase.endsWith("Telegraph")) return
        await s.wait(0.3)
      }
    },
  },
  {
    name: "camera_close",
    what: "근접 시점 · 캐릭터 디테일 · 외곽선",
    async run(s) {
      await enterMine(s)
      await pushNorth(s, 80)
      await s.page.mouse.move(640, 400)
      for (let i = 0; i < 40; i++) await s.page.mouse.wheel(0, -240)
      for (let i = 0; i < 8; i++) await s.page.keyboard.press("z")
      await s.wait(0.6)
    },
  },
]

const wanted = ONLY ? VIEWS.filter((v) => v.name.includes(ONLY)) : VIEWS
if (wanted.length === 0) {
  console.error(`--only=${ONLY} 에 맞는 뷰가 없습니다. 가능한 이름: ${VIEWS.map((v) => v.name).join(", ")}`)
  process.exit(1)
}

console.log(`[스크린샷 계약] seed=${SEED} · 품질=${QUALITY} · 뷰 ${wanted.length}개`)
const captured = []

for (const view of SHEET_ONLY ? [] : wanted) {
  // **뷰마다 세션을 새로 연다.** 한 세션에서 이어 찍으면 앞 뷰의 상태(체력·적 수·전리품)가
  // 뒤 뷰에 남아, 같은 이름의 화면이 매번 달라진다. 계약이 성립하지 않는다.
  const s = new GameSession()
  const started = Date.now()
  try {
    await s.start({ url: `${BASE}?seed=${SEED}&quality=${QUALITY}` })
    await view.run(s)
    const png = await s.page.screenshot({ encoding: "base64" })
    writeFileSync(join(OUT, `${view.name}.png`), Buffer.from(png, "base64"))
    const o = await s.observe()
    captured.push({ name: view.name, what: view.what, png })
    const secs = ((Date.now() - started) / 1000).toFixed(1)
    console.log(`  ✓ ${view.name.padEnd(16)} ${secs}s · 존 ${o.zoneId} · 에러 ${o.consoleErrors.length}`)
    if (o.consoleErrors.length > 0) console.log(`      ${o.consoleErrors.join(" | ")}`)
  } catch (err) {
    console.log(`  ✗ ${view.name.padEnd(16)} ${String(err).slice(0, 120)}`)
  } finally {
    await s.close().catch(() => {})
  }
}

if (SHEET_ONLY) {
  for (const v of wanted) {
    const p = join(OUT, `${v.name}.png`)
    if (!existsSync(p)) continue
    captured.push({ name: v.name, what: v.what, png: readFileSync(p).toString("base64") })
  }
  console.log(`  낱장 ${captured.length}장을 읽었다`)
}

// ── 대조 시트 ───────────────────────────────────────────────────
// 낱장으로 흩어져 있으면 "전보다 나아졌나" 를 판단할 수 없다. 한 장에 모은다.
if (captured.length > 0) {
  // **캔버스가 아니라 HTML 로 조립한다.**
  // 처음엔 base64 를 `page.evaluate` 인자로 넘겨 캔버스에 그렸는데, 이미지가 전부
  // broken 상태로 들어왔다(라벨만 그려진 시트가 나왔다). 데이터 URL 을 문서 자체에
  // 실어 보내면 브라우저가 알아서 디코드하므로 인자 직렬화 한계를 타지 않는다.
  const sheet = new GameSession()
  try {
    await sheet.start({ url: `${BASE}?seed=${SEED}&quality=${QUALITY}` })
    const cards = captured
      .map(
        (c) =>
          `<figure><figcaption><b>${c.name}</b><span>${c.what}</span></figcaption>` +
          `<img src="data:image/png;base64,${c.png}"></figure>`,
      )
      .join("")
    const html =
      `<!doctype html><meta charset="utf-8"><style>
        *{box-sizing:border-box;margin:0}
        body{background:#1b1611;font-family:system-ui,sans-serif;padding:14px;
             display:grid;grid-template-columns:repeat(3,1fr);gap:14px;width:1500px}
        figure{background:#241d17;border:1px solid #3a2f24;border-radius:8px;overflow:hidden}
        figcaption{display:flex;gap:10px;align-items:baseline;padding:7px 10px}
        figcaption b{color:#f0d9a8;font-size:14px}
        figcaption span{color:#9c8f7c;font-size:11.5px}
        img{display:block;width:100%}
      </style>` + cards
    // `waitUntil: "load"` 는 데이터 URL 이미지 아홉 장에서 타임아웃했다.
    // 문서만 먼저 세우고 이미지 디코드를 직접 기다린다.
    await sheet.page.setContent(html, { waitUntil: "domcontentloaded" })
    await sheet.page.evaluate(() =>
      Promise.all([...document.images].map((i) => i.decode().catch(() => {}))),
    )
    await sheet.page.waitForTimeout(300)
    const out = join(OUT, "contact-sheet.png")
    await sheet.page.screenshot({ path: out, fullPage: true })
    console.log(`
대조 시트: ${out}`)
  } catch (err) {
    console.log(`대조 시트 실패: ${String(err).slice(0, 200)}`)
  } finally {
    await sheet.close().catch(() => {})
  }
}
console.log(`낱장: ${OUT}`)
