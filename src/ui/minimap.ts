import { TILE, type DungeonMap } from "../content/map"
import type { GameWorld, Resources } from "../core/world"

/**
 * 미니맵 + 전체 지도.
 *
 * 참고한 레퍼런스(Claude of Tanks)는 HUD 계약에 `buildMinimap(heightField, features)` 을
 * 두고 **전투 시작 시 한 번** 지형을 캔버스로 굽는다. 매 프레임 다시 그리는 건 블립뿐이다.
 * 우리 맵은 격자라 더 싸다 — 벽/바닥을 한 번 굽고 그 위에 점만 찍는다.
 *
 * 왜 필요한가. 갱도가 45행으로 길어지면서 **지금 어디쯤인지, 어디로 가야 하는지**가
 * 화면만 봐서는 안 읽힌다. 카메라가 좁아서 앞뒤 교전이 안 보인다.
 *
 * 두 가지 모드가 하나의 그리기 함수를 공유한다:
 *   - **미니맵**: 우하단 고정, 플레이어 주변만 잘라 보여준다
 *   - **전체 지도**(M): 화면 가운데 크게, 맵 전체를 한 번에
 * 같은 코드를 쓰므로 둘이 어긋날 일이 없다.
 */

const MINI_SIZE = 190
const FULL_MAX = 620

/** 미니맵이 보여주는 반경(칸). 너무 넓으면 점이 뭉치고 좁으면 쓸모가 없다. */
const MINI_RADIUS = 13

const COLOR = {
  floor: "#cbb69a",
  wall: "#4a4038",
  fog: "#2b2520",
  player: "#ffffff",
  ally: "#8fd0ff",
  enemy: "#e8604a",
  elite: "#ffb03a",
  boss: "#ff3a2a",
  loot: "#ffd766",
  exit: "#7ee8c0",
} as const

interface Baked {
  canvas: HTMLCanvasElement
  cols: number
  rows: number
}

let baked: Baked | null = null
let bakedFor: DungeonMap | null = null

/** 벽/바닥을 칸당 1픽셀로 굽는다. 존이 바뀔 때만 다시 굽는다. */
function bakeTerrain(map: DungeonMap): Baked {
  const canvas = document.createElement("canvas")
  canvas.width = map.cols
  canvas.height = map.rows
  const g = canvas.getContext("2d")!
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      g.fillStyle = map.walls[r]?.[c] ? COLOR.wall : COLOR.floor
      g.fillRect(c, r, 1, 1)
    }
  }
  return { canvas, cols: map.cols, rows: map.rows }
}

interface Blip {
  col: number
  row: number
  color: string
  size: number
}

function collectBlips(world: GameWorld, res: Resources): Blip[] {
  const out: Blip[] = []
  const toCell = (x: number, z: number) => ({ col: x / TILE, row: z / TILE })

  for (const e of world.with("enemy", "transform", "health")) {
    if (e.dead) continue
    const { col, row } = toCell(e.transform.position.x, e.transform.position.z)
    const color = e.boss ? COLOR.boss : e.enemy.isElite ? COLOR.elite : COLOR.enemy
    out.push({ col, row, color, size: e.boss ? 3.4 : e.enemy.isElite ? 2.4 : 1.7 })
  }
  for (const e of world.with("lootDrop", "transform")) {
    const { col, row } = toCell(e.transform.position.x, e.transform.position.z)
    out.push({ col, row, color: COLOR.loot, size: 1.5 })
  }
  for (const e of world.with("companion", "transform")) {
    if (e.dead) continue
    const { col, row } = toCell(e.transform.position.x, e.transform.position.z)
    out.push({ col, row, color: COLOR.ally, size: 1.8 })
  }
  void res
  return out
}

/**
 * 한 장을 그린다. 미니맵과 전체 지도가 이 함수를 공유한다.
 * `radius` 가 null 이면 맵 전체를 담는다.
 */
function draw(
  g: CanvasRenderingContext2D,
  size: number,
  map: DungeonMap,
  terrain: Baked,
  playerCol: number,
  playerRow: number,
  playerYaw: number,
  blips: Blip[],
  radius: number | null,
): void {
  g.clearRect(0, 0, size, size)
  g.imageSmoothingEnabled = false

  const view = radius === null ? Math.max(map.cols, map.rows) / 2 : radius
  const scale = size / (view * 2)
  const originCol = radius === null ? map.cols / 2 : playerCol
  const originRow = radius === null ? map.rows / 2 : playerRow

  const toPx = (col: number, row: number) => ({
    x: (col - originCol) * scale + size / 2,
    y: (row - originRow) * scale + size / 2,
  })

  // 지형 — 구운 캔버스를 필요한 만큼 확대해 얹는다
  g.fillStyle = COLOR.fog
  g.fillRect(0, 0, size, size)
  const tl = toPx(0, 0)
  g.drawImage(terrain.canvas, tl.x, tl.y, terrain.cols * scale, terrain.rows * scale)

  // 출구 — 어디로 나가는지가 가장 중요한 정보다
  if (map.bossSpawn.x !== 0 || map.bossSpawn.z !== 0) {
    const b = toPx(map.bossSpawn.x / TILE, map.bossSpawn.z / TILE)
    g.strokeStyle = COLOR.boss
    g.lineWidth = 1.5
    g.beginPath()
    g.arc(b.x, b.y, Math.max(4, scale * 2), 0, Math.PI * 2)
    g.stroke()
  }

  for (const b of blips) {
    const p = toPx(b.col, b.row)
    if (p.x < -6 || p.x > size + 6 || p.y < -6 || p.y > size + 6) continue
    g.fillStyle = b.color
    g.beginPath()
    g.arc(p.x, p.y, Math.max(1.6, b.size * scale * 0.28), 0, Math.PI * 2)
    g.fill()
  }

  // 플레이어 — 시야 방향 쐐기. 점만 찍으면 어느 쪽을 보는지 모른다.
  const p = toPx(playerCol, playerRow)
  g.save()
  g.translate(p.x, p.y)
  g.rotate(-playerYaw)
  g.fillStyle = COLOR.player
  g.beginPath()
  g.moveTo(0, -7)
  g.lineTo(4.5, 5)
  g.lineTo(0, 2.5)
  g.lineTo(-4.5, 5)
  g.closePath()
  g.fill()
  g.restore()
}

let mini: HTMLCanvasElement | null = null
let full: HTMLCanvasElement | null = null
let fullWrap: HTMLElement | null = null
let fullOpen = false

function ensureDom(): void {
  if (mini) return
  mini = document.createElement("canvas")
  mini.id = "minimap"
  mini.width = MINI_SIZE
  mini.height = MINI_SIZE
  document.body.appendChild(mini)

  fullWrap = document.createElement("div")
  fullWrap.id = "fullmap"
  fullWrap.className = "hidden"
  const title = document.createElement("div")
  title.className = "fullmap-title"
  title.textContent = "지도  ·  M 으로 닫기"
  full = document.createElement("canvas")
  fullWrap.append(title, full)
  document.body.appendChild(fullWrap)
}

export function isMapOpen(): boolean {
  return fullOpen
}

export function toggleFullMap(): void {
  ensureDom()
  fullOpen = !fullOpen
  fullWrap?.classList.toggle("hidden", !fullOpen)
}

/**
 * 매 프레임 갱신. 지형은 존이 바뀔 때만 다시 굽는다.
 * 전체 지도가 닫혀 있으면 그 캔버스는 아예 그리지 않는다.
 */
export function updateMinimap(world: GameWorld, res: Resources): void {
  if (typeof document === "undefined") return // 헤드리스 시나리오 하니스
  ensureDom()
  const map = res.map
  if (!baked || bakedFor !== map) {
    baked = bakeTerrain(map)
    bakedFor = map
  }
  const player = world.with("player", "transform").entities[0]
  if (!player?.transform) return
  const pc = player.transform.position.x / TILE
  const pr = player.transform.position.z / TILE
  const blips = collectBlips(world, res)

  const mg = mini!.getContext("2d")
  if (mg) draw(mg, MINI_SIZE, map, baked, pc, pr, player.transform.yaw, blips, MINI_RADIUS)

  if (fullOpen && full) {
    const side = Math.min(FULL_MAX, Math.min(window.innerWidth, window.innerHeight) - 120)
    if (full.width !== side) { full.width = side; full.height = side }
    const fg = full.getContext("2d")
    if (fg) draw(fg, side, map, baked, pc, pr, player.transform.yaw, blips, null)
  }
}
