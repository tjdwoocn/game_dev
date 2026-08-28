/**
 * 플레이테스트 하니스 코어.
 *
 * 설계 원칙 — 이것이 이 도구의 존재 이유다:
 *   관측(observe)은 자유롭게 하되, 조작은 반드시 실제 입력 경로(마우스/키보드)로만 한다.
 *   게임 내부 상태를 직접 써서 캐릭터를 옮기거나 스탯을 바꾸는 일은 하지 않는다.
 *   그래야 "테스트는 통과했는데 사람이 하면 안 되는" 상황이 생기지 않는다.
 *
 * CLI(cli.mjs)와 MCP 서버(mcp.mjs)가 이 모듈을 공유한다.
 */

import { chromium } from "playwright"

const DEFAULT_URL = "http://localhost:5173/"

/**
 * 헤드리스 크로미움은 기본적으로 SwiftShader(소프트웨어 렌더링)를 쓴다.
 * 그 상태로 프레임 시간을 재면 실제보다 100배 가까이 느리게 나와서 성능 판단이 전부 어긋난다.
 * 실제 GPU로 붙도록 강제한다 — 창은 여전히 띄우지 않는다.
 */
const GPU_ARGS = [
  "--use-angle=default",
  "--enable-gpu",
  "--ignore-gpu-blocklist",
  "--use-gl=angle",
]

/** 게임에서 읽어오는 관측 스냅샷. 브라우저 컨텍스트에서 실행된다. */
const OBSERVE_SCRIPT = `(() => {
  if (typeof __game === "undefined") return { ready: false }
  const g = __game
  const p = g.player
  const pp = p.transform.position
  const pc = p.player
  const round = (n) => Math.round(n * 10) / 10

  const toScreen = (x, y, z) => {
    const s = g.screenOf(x, y, z)
    return {
      x: Math.round(s.x),
      y: Math.round(s.y),
      onScreen: s.x >= 0 && s.x <= window.innerWidth && s.y >= 0 && s.y <= window.innerHeight,
    }
  }

  const enemies = []
  for (const e of g.world.with("enemy", "transform", "health")) {
    if (e.dead) continue
    const ep = e.transform.position
    const s = toScreen(ep.x, 1.2, ep.z)
    enemies.push({
      kind: e.enemy.kind,
      state: e.enemy.state,
      hp: Math.round(e.health.current),
      maxHp: e.health.max,
      world: { x: round(ep.x), z: round(ep.z) },
      screen: s,
      dist: round(Math.hypot(ep.x - pp.x, ep.z - pp.z)),
      isBoss: !!e.boss,
      bossPhase: e.boss ? e.boss.phase : undefined,
      break: e.breakable ? {
        current: Math.round(e.breakable.current),
        max: e.breakable.max,
        exposed: e.breakable.exposedUntil > g.res.time.now,
        broken: e.breakable.brokenUntil > g.res.time.now,
      } : undefined,
    })
  }
  enemies.sort((a, b) => a.dist - b.dist)

  const loot = []
  for (const e of g.world.with("lootDrop", "transform")) {
    const lp = e.transform.position
    loot.push({
      name: e.lootDrop.item.name,
      rarity: e.lootDrop.item.rarity,
      world: { x: round(lp.x), z: round(lp.z) },
      screen: toScreen(lp.x, 0.9, lp.z),
      dist: round(Math.hypot(lp.x - pp.x, lp.z - pp.z)),
    })
  }
  loot.sort((a, b) => a.dist - b.dist)

  const party = []
  for (const e of g.world.with("companion", "transform", "health")) {
    const ep = e.transform.position
    party.push({
      role: e.companion.role,
      name: e.companion.name,
      hp: Math.round(e.health.current),
      maxHp: e.health.max,
      dead: !!e.dead,
      world: { x: round(ep.x), z: round(ep.z) },
      screen: toScreen(ep.x, 1.0, ep.z),
    })
  }

  const overlayEl = document.getElementById("overlay")
  const overlay = overlayEl && !overlayEl.classList.contains("hidden") ? overlayEl.textContent : null

  const visible = (id) => {
    const el = document.getElementById(id)
    return !!el && !el.classList.contains("hidden")
  }
  const hintEl = document.getElementById("interaction-hint")
  const zoneChoices = [...document.querySelectorAll("#zone-menu .zone-choice")].map((b) => b.textContent)

  return {
    ready: true,
    time: round(g.res.time.now),
    zoneId: g.res.zoneId ?? null,
    map: { cols: g.res.map.cols, rows: g.res.map.rows },
    entityCount: g.world.size,
    player: {
      world: { x: round(pp.x), z: round(pp.z) },
      screen: toScreen(pp.x, 1.0, pp.z),
      hp: Math.round(p.health.current),
      maxHp: p.health.max,
      rage: Math.round(pc.rage),
      level: pc.level,
      xp: pc.xp,
      dead: !!p.dead,
      attackPower: pc.attackPower,
      dashReady: g.res.time.now >= pc.cooldowns.dash,
      inventory: pc.inventory.map((i) => ({ name: i.name, slot: i.slot, rarity: i.rarity })),
      equipment: Object.fromEntries(
        Object.entries(pc.equipment).map(([k, v]) => [k, v ? v.name : null])
      ),
      moving: !!p.moveTarget,
    },
    enemies,
    party,
    loot,
    overlay,
    bossDefeated: !!g.res.flags.bossDefeated,
    inventoryOpen: visible("inventory"),
    interactionHint: hintEl && visible("interaction-hint") ? hintEl.textContent : null,
    zoneMenuOpen: visible("zone-menu") && zoneChoices.length > 0,
    zoneChoices,
  }
})()`

export class GameSession {
  constructor() {
    this.browser = null
    this.page = null
  }

  /**
   * 세션을 연다.
   *
   * **`headed` 기본값은 false 다.** 기본 테스트는 배경에서 돌아야 한다 — 창이 뜨면
   * 화면을 가로채고, 백그라운드 프로세스에서는 창을 못 열어 `__game` 대기가 그냥 타임아웃한다.
   * (실제로 즉석 스크립트들이 이 기본값 때문에 창을 띄우고 있었고, 배경 실행에서 죽었다)
   * 눈으로 봐야 할 때만 호출부가 `headed: true` 를 명시한다.
   *
   * `videoDir` 를 주면 세션 전체를 webm 으로 녹화한다. 헤드리스에서도 녹화되므로
   * 창을 띄우지 않고도 "움직임이 어떻게 보이는가" 를 사람이 확인할 수 있다.
   * 파일은 `close()` 시점에 쓰이므로 반드시 close 를 부른 뒤에 읽어야 한다.
   */
  async start({ url = DEFAULT_URL, headed = false, width = 1280, height = 800, videoDir = null } = {}) {
    this.browser = await chromium.launch({ headless: !headed, args: GPU_ARGS })
    const context = await this.browser.newContext({
      viewport: { width, height },
      ...(videoDir ? { recordVideo: { dir: videoDir, size: { width, height } } } : {}),
    })
    this.page = await context.newPage()
    this.errors = []
    this.page.on("console", (msg) => {
      if (msg.type() === "error") this.errors.push(msg.text())
    })
    this.page.on("pageerror", (err) => this.errors.push(String(err)))
    await this.page.goto(url, { waitUntil: "load" })
    await this.page.waitForFunction("typeof __game !== 'undefined'", { timeout: 15000 })
    await this.page.waitForTimeout(500)
    return this.observe()
  }

  async observe() {
    this.#requirePage()
    const state = await this.page.evaluate(OBSERVE_SCRIPT)
    return { ...state, consoleErrors: this.errors.slice(-5) }
  }

  /** 실제 마우스 클릭. 게임의 입력 핸들러를 그대로 거친다. */
  async click(x, y, button = "left") {
    this.#requirePage()
    await this.page.mouse.click(x, y, { button })
    await this.page.waitForTimeout(60)
    return { clicked: { x, y, button } }
  }

  /**
   * 월드 좌표 쪽으로 **클릭 이동**해서 다가간다.
   *
   * 왜 WASD 가 아니라 클릭인가. WASD 로 목표 방향을 눌러 걷는 방식은 복도를 못 지난다 —
   * 벽에 붙으면 한 축만 미끄러지다 갈림길에서 영영 맴돈다. 실제로 갱도를 길게 만들자마자
   * 하니스가 z=81 에서 12스텝을 제자리걸음했다.
   *
   * 클릭 이동은 게임의 A* 길찾기를 그대로 쓴다. 목표가 화면 밖이면 **플레이어 화면 위치에서
   * 목표 방향으로 뻗은 선이 뷰포트와 만나는 지점**을 찍는다 — 화면 밖 클릭은 페이지에 닿지
   * 않으므로 반드시 안쪽이어야 한다. 조작은 여전히 진짜 마우스 클릭이다.
   *
   * @returns 남은 거리
   */
  async travelToward(wx, wz, { within = 2.5, maxSeconds = 40 } = {}) {
    this.#requirePage()
    const started = Date.now()
    let o = await this.observe()
    let last = Infinity
    let stalled = 0
    while ((Date.now() - started) / 1000 < maxSeconds) {
      const d = Math.hypot(wx - o.player.world.x, wz - o.player.world.z)
      if (d <= within) return d
      if (d > last - 0.35) stalled++
      else stalled = 0
      if (stalled > 6) return d // 더 못 간다 — 호출 측이 판단한다
      last = d

      const target = await this.page.evaluate(
        ([x, z]) => {
          const s = window.__game.screenOf(x, 1, z)
          return { x: s.x, y: s.y }
        },
        [wx, wz],
      )
      const p = o.player.screen
      let cx = target.x
      let cy = target.y
      // 뷰포트 밖이면 플레이어 → 목표 방향으로 안쪽 지점을 잡는다
      const w = 1280, h = 800, pad = 60
      if (cx < pad || cx > w - pad || cy < pad || cy > h - pad) {
        const dx = target.x - p.x
        const dy = target.y - p.y
        const n = Math.hypot(dx, dy) || 1
        const step = Math.min(w / 2 - pad, h / 2 - pad)
        cx = p.x + (dx / n) * step
        cy = p.y + (dy / n) * step
      }
      cx = Math.max(pad, Math.min(w - pad, cx))
      cy = Math.max(pad, Math.min(h - pad, cy))
      await this.click(cx, cy)
      await this.page.waitForTimeout(700)
      o = await this.observe()
    }
    return Math.hypot(wx - o.player.world.x, wz - o.player.world.z)
  }

  /** 실제 키 입력. */
  async press(key) {
    this.#requirePage()
    await this.page.keyboard.press(key)
    await this.page.waitForTimeout(60)
    return { pressed: key }
  }

  /** 마우스 커서만 이동 (돌진 방향 지정용 — 게임이 커서 위치를 읽는다). */
  async moveMouse(x, y) {
    this.#requirePage()
    await this.page.mouse.move(x, y)
    return { moved: { x, y } }
  }

  /**
   * 페이지 안에 고빈도 관측기를 설치한다.
   *
   * observe() 왕복은 200ms 안팎이라 0.3~1초짜리 브레이크 창을 놓친다.
   * 이 추적기는 렌더 프레임마다 상태를 읽어 배열에 쌓기만 하므로 창을 놓치지 않는다.
   * 읽기 전용이다 — 게임 상태를 쓰지 않는다는 이 도구의 원칙은 그대로다.
   */
  async startTrace() {
    this.#requirePage()
    await this.page.evaluate(`(() => {
      if (window.__trace) return
      const buf = []
      window.__trace = buf
      const tick = () => {
        window.__traceRaf = requestAnimationFrame(tick)
        if (typeof __game === "undefined") return
        const g = __game
        const p = g.player
        if (!p) return
        let boss = null
        let anyExposed = false
        for (const e of g.world.with("enemy", "health")) {
          if (e.dead || !e.breakable) continue
          if (e.breakable.exposedUntil > g.res.time.now && e.breakable.brokenUntil <= g.res.time.now) anyExposed = true
          if (e.boss) boss = e
        }
        buf.push([
          Math.round(g.res.time.now * 100) / 100,
          boss ? Math.round(boss.breakable.current) : -1,
          boss ? boss.breakable.max : -1,
          boss ? (boss.breakable.exposedUntil > g.res.time.now && boss.breakable.brokenUntil <= g.res.time.now ? 1 : 0) : 0,
          boss ? (boss.breakable.brokenUntil > g.res.time.now ? 1 : 0) : 0,
          boss ? Math.round(boss.health.current) : -1,
          boss ? boss.health.max : -1,
          Math.round(p.player.rage),
          g.res.time.now >= p.player.cooldowns.dash ? 1 : 0,
          anyExposed ? 1 : 0,
          p.dead ? 1 : 0,
        ])
      }
      tick()
    })()`)
  }

  /** 설치된 추적기가 모은 시계열을 읽어온다. */
  async readTrace() {
    this.#requirePage()
    const raw = await this.page.evaluate("window.__trace ? window.__trace.slice() : []")
    return raw.map((r) => ({
      t: r[0],
      gauge: r[1] < 0 ? null : r[1],
      gaugeMax: r[2] < 0 ? null : r[2],
      exposed: r[3] === 1,
      broken: r[4] === 1,
      bossHp: r[5] < 0 ? null : r[5],
      bossMaxHp: r[6] < 0 ? null : r[6],
      rage: r[7],
      dashReady: r[8] === 1,
      anyExposed: r[9] === 1,
      playerDead: r[10] === 1,
    }))
  }

  /**
   * 적의 AI 상태를 프레임마다 기록한다 (무리 어그로 계측용).
   * 어그로가 퍼지는 순간은 0.2초 안에 끝나므로 바깥 폴링으로는 잡히지 않는다.
   * 읽기 전용이다.
   */
  async startAggroTrace() {
    this.#requirePage()
    await this.page.evaluate(`(() => {
      if (window.__aggro) return
      const buf = []
      window.__aggro = buf
      let id = 0
      const ids = new WeakMap()
      const tick = () => {
        window.__aggroRaf = requestAnimationFrame(tick)
        if (typeof __game === "undefined") return
        const g = __game
        const p = g.player
        if (!p || !p.transform) return
        const pp = p.transform.position
        const enemies = []
        for (const e of g.world.with("enemy", "transform", "health")) {
          if (e.dead) continue
          if (!ids.has(e)) ids.set(e, ++id)
          const ep = e.transform.position
          enemies.push({
            id: ids.get(e),
            state: e.enemy.state,
            distToPlayer: Math.round(Math.hypot(ep.x - pp.x, ep.z - pp.z) * 10) / 10,
          })
        }
        buf.push({ t: Math.round(g.res.time.now * 100) / 100, enemies })
      }
      tick()
    })()`)
  }

  async readAggroTrace() {
    this.#requirePage()
    return this.page.evaluate("window.__aggro ? window.__aggro.slice() : []")
  }

  /** 게임이 흘러가도록 대기. */
  async wait(seconds) {
    this.#requirePage()
    await this.page.waitForTimeout(Math.min(seconds, 30) * 1000)
    return this.observe()
  }

  async screenshot(path) {
    this.#requirePage()
    await this.page.screenshot({ path })
    return { path }
  }

  async reload(url = DEFAULT_URL) {
    this.#requirePage()
    this.errors = []
    await this.page.goto(url, { waitUntil: "load" })
    await this.page.waitForFunction("typeof __game !== 'undefined'", { timeout: 15000 })
    await this.page.waitForTimeout(500)
    return this.observe()
  }

  /** 녹화 중이면 저장된 webm 경로를 돌려준다. close() 전에 물어봐야 한다. */
  async videoPath() {
    const video = this.page?.video()
    return video ? video.path() : null
  }

  async close() {
    if (this.browser) await this.browser.close()
    this.browser = null
    this.page = null
  }

  #requirePage() {
    if (!this.page) throw new Error("세션이 시작되지 않았습니다. 먼저 start()를 호출하세요.")
  }
}
