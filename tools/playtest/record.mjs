#!/usr/bin/env node
/**
 * 녹화 검증 패스 — "무엇이 밋밋한가" 를 눈으로 본다.
 *
 * 소리·이펙트·히트스톱·경직이 다 붙은 뒤로는 숫자만으로는 판단이 안 된다.
 * 여기서 두 가지를 만든다:
 *
 *  1. **세션 영상(webm)** — 사람(PM)이 실제 움직임을 보고 판단할 자료.
 *  2. **타격 프레임 스트립(png)** — 내가 볼 자료. 타격 순간부터 20프레임을
 *     한 장에 타일로 붙인다. 0.33초짜리 스윙을 정지 이미지로 뜯어볼 수 있다.
 *
 * 스트립은 게임 캔버스를 rAF 마다 작은 타일로 복사해 만든다. 게임 상태를 쓰지 않고
 * 읽기만 하므로 이 하니스의 원칙(조작은 실제 입력으로만)을 지킨다.
 *
 *   node tools/playtest/record.mjs [출력디렉터리]
 */

import { GameSession } from "./core.mjs"
import { mkdirSync, writeFileSync, renameSync } from "node:fs"
import { join } from "node:path"

const OUT = process.argv[2] ?? "playtest-out"
/** 스트립을 어느 순간 기준으로 자를 것인가: hit(적 피해) | whirlwind(회전베기 시전) */
const TRIGGER = (process.argv.find((a) => a.startsWith("--trigger=")) ?? "--trigger=hit").slice(10)
const BASE_URL = process.env.PLAYTEST_URL ?? "http://localhost:5173/"
const TILE = 2
const GATEKEEPER = { col: 15, row: 16 }

mkdirSync(OUT, { recursive: true })

/**
 * 타격 순간부터 프레임을 타일로 붙여 한 장의 스트립을 만든다.
 * 게임의 rAF 뒤에 등록되므로 우리 콜백이 도는 시점에 드로잉 버퍼가 아직 살아 있다.
 */
const INSTALL_STRIP = (trigger) => `(() => {
  const g = window.__game
  const src = g.res.renderer.domElement
  const COLS = 6, ROWS = 4, TOTAL = COLS * ROWS, TW = 320, TH = 200
  const PRE = 5   // 타격 이전 프레임 (준비동작이 있는지 보려면 이게 있어야 한다)
  const POST = TOTAL - PRE - 1

  // 링 버퍼 — 매 프레임 찍어 두고, 타격이 감지되면 그 앞뒤로 잘라 낸다.
  const ring = []
  for (let i = 0; i < TOTAL; i++) {
    const c = document.createElement("canvas")
    c.width = TW; c.height = TH
    ring.push({ cv: c, ctx: c.getContext("2d") })
  }

  const state = { n: 0, impactN: -1, stopAt: -1, done: false, samples: [] }
  window.__strip = state

  const player = g.world.with("player", "transform").first
  const nearest = () => {
    let best = null, bd = 1e9
    for (const e of g.world.with("enemy", "transform", "health")) {
      if (e.dead) continue
      const d = Math.hypot(e.transform.position.x - player.transform.position.x,
                           e.transform.position.z - player.transform.position.z)
      if (d < bd) { bd = d; best = e }
    }
    return best
  }

  const TRIGGER = "${trigger}"
  let prevCam = null, prevP = null, prevE = null, prevHp = null, prevRage = null

  const tick = () => {
    if (state.done) return
    const n = state.n
    const slot = ring[n % TOTAL]
    try { slot.ctx.drawImage(src, 0, 0, TW, TH) } catch (err) {}

    const now = g.res.time.now
    const cam = g.res.camera.position
    const pp = player.transform.position
    const e = nearest()
    const ep = e ? e.transform.position : null
    const hs = g.res.hitstop
    const obj = player.model ? player.model.object : null

    const s = {
      n,
      gameT: +now.toFixed(3),
      realT: +g.res.time.realNow.toFixed(3),
      // 히트스톱 실제 형태는 { remaining, scale } 이다 (core/hitstop.ts)
      hsRemain: hs ? +hs.remaining.toFixed(4) : null,
      hsScale: hs ? +hs.scale.toFixed(3) : null,
      camMove: prevCam ? +Math.hypot(cam.x - prevCam.x, cam.y - prevCam.y, cam.z - prevCam.z).toFixed(4) : 0,
      pMove: prevP ? +Math.hypot(pp.x - prevP.x, pp.z - prevP.z).toFixed(4) : 0,
      pTiltX: obj ? +obj.rotation.x.toFixed(3) : null,
      pScaleY: obj ? +obj.scale.y.toFixed(3) : null,
      eHp: e ? Math.round(e.health.current) : null,
      eMove: prevE && ep ? +Math.hypot(ep.x - prevE.x, ep.z - prevE.z).toFixed(4) : 0,
      eStun: e ? !!e.hitstun : null,
      eKnock: e ? !!e.knockback : null,
      eFlash: e && e.hitFlash ? +(e.hitFlash.until - now).toFixed(3) : null,
      // 떠오르는 데미지 숫자의 실제 클래스는 .float-dmg 다 (ui/hud.ts)
      dmgPopups: document.querySelectorAll(".float-dmg").length,
    }
    state.samples.push(s)
    if (state.samples.length > TOTAL) state.samples.shift()

    // 타격 판정: 가장 가까운 적의 hp 가 줄어든 프레임
    // 기준 프레임: hit 은 적 hp 감소, whirlwind 는 분노 감소(분노를 쓰는 건 회전베기뿐)
    const fired = TRIGGER === "whirlwind"
      ? (prevRage !== null && player.player.rage < prevRage)
      : (prevHp !== null && e && e.health.current < prevHp)
    if (state.impactN < 0 && fired) {
      state.impactN = n
      state.stopAt = n + POST
    }
    prevCam = { x: cam.x, y: cam.y, z: cam.z }
    prevP = { x: pp.x, z: pp.z }
    prevE = ep ? { x: ep.x, z: ep.z } : null
    prevHp = e ? e.health.current : null
    prevRage = player.player.rage
    state.n++

    if (state.stopAt >= 0 && n >= state.stopAt) {
      // 오래된 것부터 순서대로 합쳐 한 장으로 만든다
      const out = document.createElement("canvas")
      out.width = COLS * TW; out.height = ROWS * TH
      const octx = out.getContext("2d")
      octx.fillStyle = "#111"; octx.fillRect(0, 0, out.width, out.height)
      const first = state.n - TOTAL
      for (let k = 0; k < TOTAL; k++) {
        const fn = first + k
        if (fn < 0) continue
        const c = k % COLS, r = Math.floor(k / COLS)
        octx.drawImage(ring[fn % TOTAL].cv, c * TW, r * TH)
        const off = fn - state.impactN
        const label = off === 0 ? "타격" : (off > 0 ? "+" + off : String(off))
        octx.fillStyle = off === 0 ? "rgba(200,40,40,0.85)" : "rgba(0,0,0,0.6)"
        octx.fillRect(c * TW, r * TH, 54, 20)
        octx.fillStyle = "#fff"; octx.font = "14px monospace"
        octx.fillText(label, c * TW + 6, r * TH + 15)
      }
      state.png = out.toDataURL("image/png")
      state.frames = state.samples.map((x, i) => ({ off: (first + i) - state.impactN, ...x }))
      state.done = true
      return
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  return true
})()`

async function walkTo(session, target, maxSeconds = 20) {
  await session.travelToward(target.x, target.z, { within: 1.6, maxSeconds })
  return session.observe()
}

/** 가장 가까운 적이 화면에 들어올 때까지 클릭 이동으로 다가간다 (게임의 A* 를 쓴다). */
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
let videoSrc = null
try {
  let o = await session.start({ url: BASE_URL, videoDir: OUT })
  const page = session.page
  console.log("[녹화 검증 패스]")
  console.log(`  존 ${o.zoneId} / 적 ${o.enemies.length}`)

  // 마을 → 문지기 → 갱도
  o = await walkTo(session, { x: GATEKEEPER.col * TILE, z: GATEKEEPER.row * TILE })
  await page.keyboard.press("e")
  o = await session.wait(0.8)
  const idx = Math.max(0, o.zoneChoices.findIndex((t) => t.includes("갱도")))
  await page.click(`#zone-menu .zone-choice:nth-of-type(${idx + 1})`)
  o = await session.wait(2.2)
  console.log(`  갱도 진입: 적 ${o.enemies.length}`)

  // 적 앞까지 걸어간 뒤 스트립을 무장한다
  o = await approachEnemies(session, o)
  await page.evaluate(INSTALL_STRIP(TRIGGER))

  // 전투 — 실제 클릭으로만
  for (let i = 0; i < 14; i++) {
    o = await approachEnemies(session, o)
    const e = o.enemies.find((x) => x.screen.onScreen)
    if (!e) break
    await session.click(e.screen.x, e.screen.y)
    o = await session.wait(1.4)
    if (TRIGGER === "whirlwind" && o.player.rage >= 25) {
      await session.click(o.player.screen.x, o.player.screen.y, "right")
      o = await session.wait(1.2)
    }
    const done = await page.evaluate("window.__strip ? window.__strip.done : false")
    if (done) break
  }

  const strip = await page.evaluate(`(() => {
    const s = window.__strip
    return s ? { done: s.done, n: s.n, impactN: s.impactN, png: s.png ?? null, frames: s.frames ?? [] } : null
  })()`)

  if (strip?.png) {
    writeFileSync(join(OUT, "hit-strip.png"), Buffer.from(strip.png.split(",")[1], "base64"))
    writeFileSync(join(OUT, "hit-timeline.json"), JSON.stringify(strip.frames, null, 1))
    console.log(`  타격 스트립: ${strip.frames.length}프레임 (타격 = 프레임 ${strip.impactN}) → hit-strip.png`)
  } else {
    console.log(`  타격 스트립 실패 (관측 ${strip?.n ?? 0}프레임, 타격감지 ${strip?.impactN ?? -1})`)
  }

  // 마무리로 조금 더 논다 — 영상에 전리품 획득과 이동이 남도록
  for (let i = 0; i < 6; i++) {
    const labels = await page.$$(".loot-label")
    if (labels.length > 0) { await labels[0].click().catch(() => {}); o = await session.wait(0.6); continue }
    o = await approachEnemies(session, o)
    const e = o.enemies.find((x) => x.screen.onScreen)
    if (!e) break
    await session.click(e.screen.x, e.screen.y)
    o = await session.wait(1.6)
  }

  console.log(`  최종: hp ${o.player.hp} / 인벤 ${o.player.inventory.length} / 콘솔 에러 ${o.consoleErrors.length}`)
  videoSrc = await session.videoPath()
} finally {
  await session.close().catch(() => {})
}

if (videoSrc) {
  const dest = join(OUT, "session.webm")
  try { renameSync(videoSrc, dest); console.log(`  영상: ${dest}`) } catch { console.log(`  영상: ${videoSrc}`) }
}
