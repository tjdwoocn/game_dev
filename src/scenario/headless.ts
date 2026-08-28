import * as THREE from "three"
import { createWorld, type Entity, type GameWorld, type Resources } from "../core/world"
import { createHitstop } from "../core/hitstop"
import { createGameplayEventBuffer } from "../core/events"
import { parseMap } from "../content/map"
import { MAP_LAYOUTS } from "../content/maps"
import { PARTY_CONFIG } from "../content/party"
import { spawnCompanion } from "../content/companions"
import { createZoneRuntime, enterZone, type ZoneRuntime } from "../systems/zone"
import type { Hud } from "../ui/hud"

/**
 * 헤드리스 게임 인스턴스 — **브라우저 없이 진짜 전투를 돌린다.**
 *
 * 왜 만들었나. 단위 테스트 285건은 전부 순수 함수 하나짜리였고, **전체 시뮬레이션
 * 루프를 도는 테스트가 하나도 없었다.** 그래서 "적이 안 쫓아온다", "넉백이 안 보인다",
 * "회전베기가 안 맞는다" 같은 문제가 전부 브라우저에서만 드러났고, 한 번 확인하는 데
 * 수십 초가 걸렸다. 여기서는 같은 상황을 밀리초 단위로 돌리고 되감을 수 있다.
 *
 * 원칙은 플레이테스트 하니스와 같다 — **조작은 실제 경로로만.** 엔티티 좌표를 손으로
 * 옮기지 않고, `attackIntent`/`moveTarget`/`skillIntent` 같은 실제 의도 컴포넌트를 통해서만
 * 명령한다. 그래야 "텍스트에서는 되는데 게임에서는 안 되는" 상황이 안 생긴다.
 *
 * three 는 import 하지만 WebGL 은 쓰지 않는다. `Scene`/`PerspectiveCamera` 는 순수
 * 자바스크립트 객체라 node 에서 그대로 동작한다. 렌더러만 스텁이다.
 */

/** 결정적 난수. 같은 시드는 같은 전투를 만든다 — 시나리오가 재현 가능해야 한다. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** HUD 는 전부 무동작. 다만 무엇이 불렸는지는 남겨 둔다 — 텍스트 로그가 이걸 읽는다. */
export interface HudLog {
  overlays: string[]
  damages: { text: string; cls?: string }[]
  hints: (string | null)[]
  levelUps: number
}

function createStubHud(log: HudLog): Hud {
  return {
    setHp: () => {},
    setRage: () => {},
    setXp: () => {},
    setSkillCooldown: () => {},
    setSkillInsufficient: () => {},
    showDamage: (_x, _y, text, cls) => log.damages.push({ text, cls }),
    setOverlay: (html) => { if (html) log.overlays.push(html) },
    setBossBar: () => {},
    setBossBreak: () => {},
    setInteractionHint: (text) => { if (log.hints.at(-1) !== text) log.hints.push(text) },
    showZoneMenu: () => {},
    hideZoneMenu: () => {},
    flashLevelUp: () => { log.levelUps++ },
    syncEnemyBars: () => {},
    syncLootLabels: () => {},
    toggleInventory: () => {},
    isInventoryOpen: () => false,
    renderInventory: () => {},
    setPartyStatus: () => {},
  }
}

export interface Game {
  world: GameWorld
  res: Resources
  player: Entity
  runtime: ZoneRuntime
  hudLog: HudLog
}

export interface GameOptions {
  /** 시작 존. 기본은 마을. */
  zoneId?: string
  /** 난수 시드. 같은 시드 = 같은 전투. */
  seed?: number
  /** 동료를 붙일지. 1:1 전투를 볼 때는 끈다. */
  companions?: boolean
}

/** 브라우저 main.ts 와 같은 순서로 세계를 세운다. 렌더·입력·오디오만 뺐다. */
export function createGame(opts: GameOptions = {}): Game {
  const zoneId = opts.zoneId ?? "town"
  const layout = MAP_LAYOUTS[zoneId === "town" ? "town" : zoneId]
  const initialMap = parseMap(layout ?? MAP_LAYOUTS.town!)

  const hudLog: HudLog = { overlays: [], damages: [], hints: [], levelUps: 0 }
  const world = createWorld()
  const res: Resources = {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 200),
    // 렌더러는 헤드리스에서 만들 수 없다. 시뮬레이션 시스템은 이걸 읽지 않는다.
    renderer: null as unknown as THREE.WebGLRenderer,
    input: {
      clicks: [], dashQueued: false, skillQueued: null, pointer: { ndcX: 0, ndcY: 0 },
      toggleInventory: false, toggleMap: false, toggleStats: false, toggleSkills: false, zoomDelta: 0, rotateCamera: 0, pitchCamera: 0,
      returnTownQueued: false, interactQueued: false, held: new Set<string>(),
    },
    time: { now: 0, realNow: 0 },
    hitstop: createHitstop(),
    events: createGameplayEventBuffer(),
    rng: mulberry32(opts.seed ?? 12345),
    map: initialMap,
    zoneId: "town",
    hud: createStubHud(hudLog),
    flags: { bossDefeated: false },
  }

  const player: Entity = world.add({
    transform: { position: { x: initialMap.playerSpawn.x, y: 0, z: initialMap.playerSpawn.z }, yaw: 0 },
    speed: 6,
    radius: 0.45,
    health: { current: 100, max: 100 },
    attack: { damage: 12, range: 1.8, arc: 1.75, cooldown: 0.5, readyAt: 0, breakPower: 10 },
    player: {
      rage: 0, maxRage: 100, level: 1, xp: 0,
      baseAttack: 12, baseMaxHp: 100, baseSpeed: 6,
      attackPower: 12, moveSpeed: 6,
      critChance: 0, critDamage: 150, attackSpeedPct: 0,
      breakPower: 0, cooldownReductionPct: 0, lifeOnKill: 0,
      inventory: [], equipment: {}, cooldowns: { dash: 0, whirlwind: 0, guard: 0, execution: 0 },
    },
    model: { kind: "player" },
  })

  if (opts.companions !== false) {
    for (const role of PARTY_CONFIG.activeCompanionRoles) {
      const offset = PARTY_CONFIG.formation[role]
      spawnCompanion(
        world, role,
        player.transform!.position.x + offset.x,
        player.transform!.position.z + offset.z,
        offset,
      )
    }
  }

  const runtime = createZoneRuntime("town")
  enterZone(world, res, runtime, "town")
  if (zoneId !== "town") enterZone(world, res, runtime, zoneId)

  return { world, res, player, runtime, hudLog }
}
