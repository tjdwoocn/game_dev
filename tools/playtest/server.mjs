/**
 * 플레이테스트 세션 서버.
 *
 * 브라우저 세션을 프로세스에 살려두고 HTTP로 조작을 받는다.
 * CLI 한 번 호출 = 프로세스 한 번 실행이라, 세션을 유지하려면 이런 상주 프로세스가 필요하다.
 * 덕분에 "관찰 → 클릭 → 다시 관찰"을 여러 번에 나눠서 할 수 있다.
 */

import { createServer } from "node:http"
import { GameSession } from "./core.mjs"

const PORT = Number(process.env.PLAYTEST_PORT ?? 7391)
const session = new GameSession()

const readBody = (req) =>
  new Promise((resolve) => {
    let data = ""
    req.on("data", (c) => (data += c))
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch {
        resolve({})
      }
    })
  })

const ROUTES = {
  "/start": (a) => session.start(a),
  "/observe": () => session.observe(),
  "/click": (a) => session.click(a.x, a.y, a.button ?? "left"),
  "/press": (a) => session.press(a.key),
  "/mouse": (a) => session.moveMouse(a.x, a.y),
  "/wait": (a) => session.wait(a.seconds ?? 1),
  "/screenshot": (a) => session.screenshot(a.path),
  "/reload": (a) => session.reload(a.url),
  "/ping": async () => ({ ok: true }),
}

const server = createServer(async (req, res) => {
  const route = ROUTES[req.url]
  if (!route) {
    res.writeHead(404).end(JSON.stringify({ error: "unknown route: " + req.url }))
    return
  }
  try {
    const args = await readBody(req)
    const result = await route(args)
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify(result))
  } catch (err) {
    res.writeHead(500, { "content-type": "application/json" })
    res.end(JSON.stringify({ error: String(err?.message ?? err) }))
  }
})

server.listen(PORT, () => console.log(`playtest server listening on ${PORT}`))

const shutdown = async () => {
  await session.close().catch(() => {})
  server.close()
  process.exit(0)
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
