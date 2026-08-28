import * as THREE from "three"
import { TILE, type DungeonMap } from "../content/map"
import { KIT_SCALE, PROPS_BY_MAP, type PropDef } from "../content/dungeonKit"
import { TOWN_NPCS } from "../content/maps"

/**
 * 던전 소품 배치 — 던전을 "사람이 쓰던 곳"으로 만든다.
 *
 * **에셋 24개 중 8개만 쓰고 있었다.** 통·상자·잔해·탁자·촛대 선반 10종이
 * `content/dungeonKit.ts` 에 카탈로그까지 갖춰져 있는데 **배치 코드가 아예 없었고
 * 로딩 목록에도 없었다.** 이미 값을 치른 에셋이 그냥 놀고 있었다.
 *
 * ## 어디에 놓는가
 *
 * 이 소품들은 **충돌이 없는 순수 장식**이다(엔티티가 아니다). 통로 한가운데 두면
 * 플레이어가 통 속을 걸어 지나가는 게 그대로 보인다. 그래서 **벽에 맞닿은 칸에만**
 * 놓고, 벽을 많이 낀 칸일수록 큰 소품을 준다:
 *
 *   벽 3면(막다른 구석) → 큰 소품    벽 2면(모서리) → 중간    벽 1면(벽가) → 작은 것
 *   벽 0면(통로 한복판) → **놓지 않는다**
 *
 * 사람이 물건을 두는 자리와도 맞는다 — 짐은 벽에 붙여 쌓지 길 한가운데 두지 않는다.
 *
 * ## 왜 결정적인가
 *
 * 좌표 해시로 뽑는다. 같은 맵은 항상 같은 배치가 되어야 한다 —
 * 존을 나갔다 들어올 때마다 통이 옮겨 다니면 공간을 기억할 수 없다.
 */

/** 스폰·출구·보스 지점 주변은 비운다. 첫인상과 전투 공간을 소품으로 막지 않는다. */
const CLEAR_RADIUS = 3.2

export interface PropDressing {
  /** 후보 칸 중 실제로 소품을 놓을 비율. 높을수록 어수선하다. */
  density: number
  note: string
}

/**
 * 존별 밀도. 방의 성격을 소품 양으로도 말한다 —
 * 마을과 갱도는 사람이 쓰던 곳이라 물건이 많고, 납골당은 비어 있어야 으스스하다.
 */
export const PROP_DRESSING: Record<string, PropDressing> = {
  town: { density: 0.34, note: "등불 마을 — 사람이 사는 곳. 통과 상자가 흔하다" },
  mine: { density: 0.3, note: "무너진 갱도 — 채굴 보급품과 잔해" },
  hall: { density: 0.22, note: "무너진 회랑 — 부서진 세간" },
  catacomb: { density: 0.14, note: "지하 납골당 — 비어 있어야 으스스하다" },
  bridge: { density: 0.18, note: "갈라진 회랑 — 옮기다 만 짐" },
  throne: { density: 0.24, note: "왕좌의 방 — 격식 있는 세간" },
  cistern: { density: 0.12, note: "함몰 지하수로 — 물에 쓸려 거의 남지 않았다" },
  crucible: { density: 0.2, note: "시련의 회랑 — 불에 그을린 잔해" },
}

const DEFAULT_DRESSING: PropDressing = { density: 0.2, note: "미등록 맵 폴백" }

export function getPropDressing(mapId: string): PropDressing {
  return PROP_DRESSING[mapId] ?? DEFAULT_DRESSING
}

/** 결정적 의사난수. `dungeonDressing` 과 같은 방식이라 배치가 재현된다. */
function cellHash(c: number, r: number, salt = 0): number {
  const n = Math.sin(c * 311.7 + r * 127.1 + salt * 74.7) * 43758.5453
  return n - Math.floor(n)
}

function walkable(map: DungeonMap, c: number, r: number): boolean {
  if (r < 0 || r >= map.rows || c < 0 || c >= map.cols) return false
  return !(map.walls[r]?.[c] ?? true)
}

/** 상하좌우 중 벽인 면의 수. 놓을 자리와 크기를 정하는 유일한 기준이다. */
function wallSides(map: DungeonMap, c: number, r: number): number {
  let n = 0
  if (!walkable(map, c + 1, r)) n++
  if (!walkable(map, c - 1, r)) n++
  if (!walkable(map, c, r + 1)) n++
  if (!walkable(map, c, r - 1)) n++
  return n
}

/** 벽 쪽을 등지도록 돌린다. 상자가 벽을 보고 서 있으면 어색하다. */
function facingAwayFromWall(map: DungeonMap, c: number, r: number): number {
  if (!walkable(map, c, r - 1)) return 0 // 북쪽이 벽 → 남쪽(+Z)을 본다
  if (!walkable(map, c, r + 1)) return Math.PI
  if (!walkable(map, c - 1, r)) return Math.PI / 2
  if (!walkable(map, c + 1, r)) return -Math.PI / 2
  return 0
}

interface Placement {
  file: string
  x: number
  z: number
  yaw: number
  scale: number
}

/**
 * 배치 목록을 만든다. 렌더에 의존하지 않는 **순수 함수**라 단위 테스트로 검증한다.
 * (통로 한복판에 놓지 않는가, 스폰을 막지 않는가)
 */
export function planProps(map: DungeonMap, mapId: string): Placement[] {
  const pool = PROPS_BY_MAP[mapId] ?? []
  if (pool.length === 0) return []
  const dressing = getPropDressing(mapId)
  const out: Placement[] = []

  // 크기별로 나눠 두되, **벽 1면 칸에서도 전체 풀에서 뽑는다.**
  // 처음엔 벽 1면이면 작은 것만 뽑게 했는데, 무너진 회랑처럼 모서리가 적은 맵은
  // 소품이 한 종류(잔해)로만 채워져 오히려 더 단조로워졌다.
  // 벽에 붙은 통은 자연스럽다 — 크기는 확률로 편향시키면 충분하다.
  const big = pool.filter((p) => p.blocking)
  const small = pool.filter((p) => !p.blocking)
  const pick = (list: PropDef[], h: number): PropDef | null =>
    list.length === 0 ? null : list[Math.floor(h * list.length) % list.length]!
  /** 벽을 많이 낀 칸일수록 큰 소품이 나올 확률이 높다. */
  const pickFor = (sides: number, h: number): PropDef | null => {
    const bigChance = sides >= 3 ? 0.85 : sides === 2 ? 0.6 : 0.35
    const wantBig = h < bigChance
    const first = wantBig ? big : small
    const second = wantBig ? small : big
    return pick(first.length ? first : second, (h * 7.3) % 1)
  }

  // 비워야 할 자리. 스폰·보스뿐 아니라 **마을 NPC** 도 포함한다 —
  // 문지기 앞에 통이 놓이면 말을 걸러 다가가는 길이 막힌 것처럼 보인다.
  const keepClear = [
    map.playerSpawn,
    map.bossSpawn,
    ...map.spawns.map((s) => ({ x: s.x, z: s.z })),
    ...(mapId === "town" ? TOWN_NPCS.map((n) => ({ x: n.cell.col * TILE, z: n.cell.row * TILE })) : []),
  ]

  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      if (!walkable(map, c, r)) continue
      const sides = wallSides(map, c, r)
      if (sides === 0) continue // 통로 한복판 — 통과해 지나가는 게 그대로 보인다

      const h = cellHash(c, r)
      // 벽을 많이 낀 칸일수록 놓일 확률이 높다. 구석이 먼저 찬다.
      if (h > dressing.density * (0.55 + sides * 0.35)) continue

      const x = c * TILE
      const z = r * TILE
      if (keepClear.some((p) => Math.hypot(p.x - x, p.z - z) < CLEAR_RADIUS)) continue

      const def = pickFor(sides, cellHash(c, r, 1))
      if (!def) continue

      out.push({
        file: def.file,
        x,
        z,
        yaw: facingAwayFromWall(map, c, r) + (cellHash(c, r, 2) - 0.5) * 0.5,
        // 같은 모델이 같은 크기로 늘어서면 복사한 티가 난다
        scale: 0.85 + cellHash(c, r, 3) * 0.35,
      })
    }
  }
  return out
}

/** 배치에 필요한 모델 파일 이름 전부. 로딩 목록을 만들 때 쓴다. */
export function propFiles(): string[] {
  const set = new Set<string>()
  for (const list of Object.values(PROPS_BY_MAP)) for (const p of list) set.add(p.file)
  return [...set]
}

/**
 * 실제 메시를 만든다. 소품 종류마다 인스턴스 하나이므로, 수백 개를 놓아도
 * 드로우콜은 종류 수만큼이다.
 */
export function buildProps(
  scene: THREE.Object3D,
  placements: Placement[],
  getPiece: (file: string) => { geometry: THREE.BufferGeometry; material: THREE.Material } | undefined,
  tint?: number,
): number {
  const byFile = new Map<string, Placement[]>()
  for (const p of placements) {
    const list = byFile.get(p.file) ?? []
    list.push(p)
    byFile.set(p.file, list)
  }

  let placed = 0
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const pos = new THREE.Vector3()
  const scl = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)

  for (const [file, list] of byFile) {
    const piece = getPiece(file)
    if (!piece) continue
    const mesh = new THREE.InstancedMesh(piece.geometry, piece.material, list.length)
    if (tint !== undefined && tint !== 0xffffff) {
      const col = new THREE.Color(tint)
      for (let i = 0; i < list.length; i++) mesh.setColorAt(i, col)
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    list.forEach((p, i) => {
      const s = p.scale * KIT_SCALE
      pos.set(p.x, 0, p.z)
      q.setFromAxisAngle(up, p.yaw)
      scl.set(s, s, s)
      m.compose(pos, q, scl)
      mesh.setMatrixAt(i, m)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.computeBoundingSphere()
    scene.add(mesh)
    placed += list.length
  }
  return placed
}
