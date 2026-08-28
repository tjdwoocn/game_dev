import type { EnemyKind, Vec2 } from "../core/world"

export const TILE = 2

export interface DungeonMap {
  cols: number
  rows: number
  walls: boolean[][] // [row][col], true = 벽
  playerSpawn: Vec2
  spawns: { kind: EnemyKind; x: number; z: number; isElite?: boolean }[]
  bossSpawn: Vec2
}

/** 레이아웃 문자와 분리해 티어를 지정할 수 있는 맵 좌표. */
export interface MapCell {
  col: number
  row: number
}

const SPAWN_CHARS: Record<string, EnemyKind> = { w: "warrior", a: "archer", c: "charger" }

export function parseMap(layout: string[], eliteCells: readonly MapCell[] = []): DungeonMap {
  const rows = layout.length
  const cols = Math.max(...layout.map((r) => r.length))
  const walls: boolean[][] = []
  let playerSpawn: Vec2 = { x: 0, z: 0 }
  let bossSpawn: Vec2 = { x: 0, z: 0 }
  const spawns: DungeonMap["spawns"] = []
  const eliteKeys = new Set(eliteCells.map(({ col, row }) => `${col},${row}`))

  for (let r = 0; r < rows; r++) {
    const line = layout[r] ?? ""
    const wallRow: boolean[] = []
    for (let c = 0; c < cols; c++) {
      const ch = line[c] ?? "#"
      wallRow.push(ch === "#")
      const x = c * TILE
      const z = r * TILE
      if (ch === "P") playerSpawn = { x, z }
      else if (ch === "B") bossSpawn = { x, z }
      else {
        const kind = SPAWN_CHARS[ch]
        if (kind) spawns.push({ kind, x, z, isElite: eliteKeys.has(`${c},${r}`) || undefined })
      }
    }
    walls.push(wallRow)
  }
  return { cols, rows, walls, playerSpawn, spawns, bossSpawn }
}

export function worldToCell(w: number): number {
  return Math.round(w / TILE)
}

export function isWalkable(map: DungeonMap, wx: number, wz: number): boolean {
  const c = worldToCell(wx)
  const r = worldToCell(wz)
  if (r < 0 || r >= map.rows || c < 0 || c >= map.cols) return false
  return !(map.walls[r]?.[c] ?? true)
}

/**
 * 입구홀(하단, P) → 복도 → 전투방 3개 → 보스방(상단, B)
 *
 * 배치는 핵앤슬래시 밀도를 따른다 — 한둘씩 마주치는 것이 아니라 무리로 덤벼야 한다.
 * 근접형을 앞줄에, 원거리형을 뒷줄에 두어 진입하는 쪽이 근접을 뚫고 들어가게 만든다.
 * 방이 깊어질수록 무리가 커진다(8 → 13 → 16). 입구홀은 비워 둔다.
 * 보스방에는 호위 6기를 두어 보스와 잡몹 중 무엇을 먼저 칠지 고르게 한다.
 */
export const DUNGEON_LAYOUT: string[] = [
  "####################################",
  "############............############",
  "############..w......w..############",
  "############.....B......############",
  "############..a......a..############",
  "############...w....w...############",
  "############............############",
  "#################..#################",
  "#################..#################",
  "########...a......a......a..########",
  "########.w...w...w...w...w..########",
  "########....a.........a.....########",
  "########..w....w....w....w..########",
  "########......w......w......########",
  "########....................########",
  "##########..########################",
  "##########..########################",
  "######..a....a....a...##############",
  "######.w..w..w..w..w..##############",
  "######...w....w....w..##############",
  "######.....w....w.....##############",
  "##################..################",
  "##################..################",
  "############...a.......a....########",
  "############..w..w....w..w..########",
  "############.....w....w.....########",
  "##############..####################",
  "##############..####################",
  "##########................##########",
  "##########.......P........##########",
  "##########................##########",
  "##########................##########",
  "####################################",
]

export const DUNGEON = parseMap(DUNGEON_LAYOUT)
