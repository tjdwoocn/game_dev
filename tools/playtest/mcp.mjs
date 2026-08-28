#!/usr/bin/env node
/**
 * 플레이테스트 MCP 서버.
 *
 * Claude Desktop / Claude Code 에 등록하면 AI가 이 게임을 직접 플레이할 수 있다.
 * 포켓몬 에뮬레이터 MCP 서버와 같은 발상 — 에뮬레이터 대신 브라우저,
 * 버튼 입력 대신 마우스/키, RAM 덤프 대신 ECS 월드 관측이다.
 *
 * 조작 도구(click/press/mouse)는 전부 실제 입력 이벤트를 발생시킨다.
 * 게임 내부 상태를 직접 바꾸는 도구는 의도적으로 제공하지 않는다.
 *
 * 등록 예 (claude_desktop_config.json):
 *   "arpg-playtest": {
 *     "command": "node",
 *     "args": ["C:/Users/User/Documents/arpg-prototype/tools/playtest/mcp.mjs"]
 *   }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { GameSession } from "./core.mjs"
import { createTracker, formatReport } from "./scenario.mjs"

const BASE_URL = process.env.PLAYTEST_URL ?? "http://localhost:5173/"
const session = new GameSession()
const tracker = createTracker()

const text = (value) => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
})

/** 관측할 때마다 진행도 이력을 갱신해 둔다 (체크포인트 판정용) */
async function observeAndTrack() {
  const o = await session.observe()
  tracker.update(o)
  return o
}

const server = new McpServer({ name: "arpg-playtest", version: "0.1.0" })

server.tool(
  "game_start",
  "게임을 브라우저에 띄우고 플레이테스트 세션을 시작한다. 시작 직후의 관측 결과를 돌려준다.",
  {
    headed: z.boolean().optional().describe("true면 보이는 창으로 띄운다 (기본: 헤드리스)"),
    autoplay: z.boolean().optional().describe("true면 게임 내장 자동 플레이 봇을 켠다"),
  },
  async ({ headed = false, autoplay = false }) => {
    const o = await session.start({ url: autoplay ? `${BASE_URL}?autoplay=1` : BASE_URL, headed })
    tracker.update(o)
    return text(o)
  },
)

server.tool(
  "game_observe",
  "현재 게임 상태를 관측한다. 플레이어 스탯/위치, 화면에 보이는 적과 아이템(화면 좌표 포함), 오버레이 메시지, 콘솔 에러를 돌려준다. 적/아이템의 screen 좌표를 game_click 에 그대로 넘기면 된다.",
  {},
  async () => text(await observeAndTrack()),
)

server.tool(
  "game_click",
  "화면 좌표에 실제 마우스 클릭을 보낸다. 좌클릭은 지면이면 이동, 적이면 접근 후 공격. 우클릭은 회전베기.",
  {
    x: z.number().describe("화면 x 좌표 (픽셀)"),
    y: z.number().describe("화면 y 좌표 (픽셀)"),
    button: z.enum(["left", "right"]).optional().describe("기본 left"),
  },
  async ({ x, y, button = "left" }) => {
    await session.click(x, y, button)
    return text(await observeAndTrack())
  },
)

server.tool(
  "game_press",
  "실제 키 입력을 보낸다. Space=돌진(마우스 커서 방향), KeyI=인벤토리 토글.",
  { key: z.string().describe("키 코드 (예: Space, KeyI)") },
  async ({ key }) => {
    await session.press(key)
    return text(await observeAndTrack())
  },
)

server.tool(
  "game_mouse",
  "마우스 커서만 이동시킨다. 돌진 방향을 정할 때 game_press('Space') 직전에 사용한다.",
  { x: z.number(), y: z.number() },
  async ({ x, y }) => text(await session.moveMouse(x, y)),
)

server.tool(
  "game_wait",
  "게임이 흘러가도록 기다린 뒤 관측한다. 이동이나 전투 결과를 보려면 1~3초를 기다린다.",
  { seconds: z.number().min(0.1).max(30).describe("대기 시간(초)") },
  async ({ seconds }) => {
    await session.wait(seconds)
    return text(await observeAndTrack())
  },
)

server.tool(
  "game_screenshot",
  "현재 화면을 PNG 파일로 저장한다.",
  { path: z.string().describe("저장할 파일 경로") },
  async ({ path }) => text(await session.screenshot(path)),
)

server.tool(
  "game_checkpoints",
  "지금까지의 플레이 진행도를 체크포인트(micro/landmark/objective)로 판정해 리포트한다.",
  {},
  async () => {
    const o = await observeAndTrack()
    return text(formatReport(tracker.evaluate(o), tracker.ctx, Math.round(o.time ?? 0)))
  },
)

server.tool(
  "game_reset",
  "게임을 처음부터 다시 시작한다.",
  { autoplay: z.boolean().optional() },
  async ({ autoplay = false }) => {
    const o = await session.reload(autoplay ? `${BASE_URL}?autoplay=1` : BASE_URL)
    tracker.update(o)
    return text(o)
  },
)

await server.connect(new StdioServerTransport())
