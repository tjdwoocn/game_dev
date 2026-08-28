/**
 * 일회성 조사 — 카메라를 최저 pitch(35도)까지 내렸을 때 하늘이 보이는가.
 * 절차적 하늘 이식이 값어치가 있는지 판단하려고 찍는다.
 */
import { GameSession } from "./core.mjs"
import { mkdirSync, writeFileSync } from "node:fs"

const OUT = "playtest-out/skyprobe"
mkdirSync(OUT, { recursive: true })
const BASE = process.env.PLAYTEST_URL ?? "http://localhost:5173/"

const s = new GameSession()
await s.start({ url: `${BASE}?seed=20260828&quality=high` })
await s.wait(1500)

// X 를 여러 번 눌러 pitch 를 최저(35도)까지 내린다. 5도씩이라 넉넉히 12번.
for (let i = 0; i < 12; i++) await s.press("KeyX")
await s.wait(600)
// 휠 줌도 최대로 당겨 지평선을 최대한 노출시킨다.
await s.press("KeyX")
await s.wait(800)

const shot = await s.page.screenshot()
writeFileSync(`${OUT}/town-low-pitch.png`, shot)

const info = await s.page.evaluate(`(() => {
  const g = window.__game
  if (!g) return null
  return { pitch: g.cameraRig ? g.cameraRig.pitch : null, zone: g.res ? g.res.zoneId : null }
})()`)
console.log("카메라 상태:", JSON.stringify(info))
console.log(`저각 스크린샷: ${OUT}/town-low-pitch.png`)
await s.stop()
