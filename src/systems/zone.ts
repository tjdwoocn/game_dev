import { MAP_LAYOUTS } from "../content/maps"
import { cellToWorld, getZone, type ZoneDefinition, type ZoneExit } from "../content/zones"
import { parseMap, type DungeonMap } from "../content/map"
import { spawnEnemy } from "../content/enemies"
import { PARTY_CONFIG } from "../content/party"
import type { BossComp, Entity, GameWorld, Resources, Vec2 } from "../core/world"
import { buildMapMeshes } from "./render"
import { spawnDestructibles } from "./destructibles"

const EXIT_RADIUS = 1.25
const EXIT_RELEASE_RADIUS = 2.5
const TRANSITION_LOCK = 0.8

export interface ZoneRuntime {
  currentZoneId: string
  requestedZoneId: string | null
  transitionLockUntil: number
  blockedExit: { zoneId: string; exit: ZoneExit } | null
}

export function createZoneRuntime(initialZoneId = "town"): ZoneRuntime {
  return {
    currentZoneId: initialZoneId,
    requestedZoneId: null,
    transitionLockUntil: 0,
    blockedExit: null,
  }
}

/** NPC·문지기 UI가 나중에 사용할 명시적 존 이동 요청 API. */
export function requestZoneTransition(runtime: ZoneRuntime, targetZoneId: string): void {
  runtime.requestedZoneId = targetZoneId
}

function removeComponentIfPresent<K extends keyof Entity>(world: GameWorld, e: Entity, key: K): void {
  if (e[key] !== undefined) world.removeComponent(e, key)
}

function clearTransientEntities(world: GameWorld, res: Resources): void {
  for (const entity of [
    ...world.with("enemy"),
    ...world.with("projectile"),
    ...world.with("lootDrop"),
    ...world.with("destructible"),
  ]) {
    if (entity.model?.object) res.scene.remove(entity.model.object)
    if (world.has(entity)) world.remove(entity)
  }

  for (const entity of [
    ...world.with("player"),
    ...world.with("companion"),
  ]) {
    removeComponentIfPresent(world, entity, "moveTarget")
    removeComponentIfPresent(world, entity, "path")
    removeComponentIfPresent(world, entity, "attackIntent")
    removeComponentIfPresent(world, entity, "skillIntent")
    removeComponentIfPresent(world, entity, "action")
    removeComponentIfPresent(world, entity, "skillBuffer")
    removeComponentIfPresent(world, entity, "guarding")
    removeComponentIfPresent(world, entity, "knockback")
    removeComponentIfPresent(world, entity, "stunned")
    if (entity.companion?.state) entity.companion.state = "follow"
    if (entity.dead) {
      world.removeComponent(entity, "dead")
      if (entity.health) entity.health.current = entity.health.max
    }
  }
}

function spawnBoss(world: GameWorld, map: DungeonMap, def: ZoneDefinition): void {
  if (!def.hasBoss) return
  const boss = spawnEnemy(world, "boss", map.bossSpawn.x, map.bossSpawn.z)
  const bossState: BossComp = {
    phase: "idle",
    phaseUntil: 0,
    slamCount: 0,
    nextPatternAt: 0,
    chargeDir: { x: 0, z: 1 },
    engaged: false,
  }
  world.addComponent(boss, "boss", bossState)
}

function resetCompanions(world: GameWorld, player: Entity): void {
  if (!player.transform) return
  let index = 0
  for (const companion of world.with("companion", "transform")) {
    const role = companion.companion.role
    const offset = PARTY_CONFIG.formation[role]
    companion.transform.position.x = player.transform.position.x + offset.x
    companion.transform.position.z = player.transform.position.z + offset.z
    companion.transform.yaw = 0
    index++
  }
  void index
}

export function enterZone(
  world: GameWorld,
  res: Resources,
  runtime: ZoneRuntime,
  targetZoneId: string,
  entryCell?: { col: number; row: number },
): boolean {
  const previousZoneId = runtime.currentZoneId
  const def = getZone(targetZoneId)
  const layout = def ? MAP_LAYOUTS[def.mapId] : undefined
  const player = world.with("player", "transform", "health").entities[0]
  if (!def || !layout || !player) return false

  const map = parseMap(layout, def.eliteCells ?? [])
  clearTransientEntities(world, res)

  res.map = map
  res.zoneId = targetZoneId
  res.flags.bossDefeated = false
  runtime.currentZoneId = targetZoneId
  runtime.requestedZoneId = null
  runtime.transitionLockUntil = res.time.now + TRANSITION_LOCK

  buildMapMeshes(res.scene, map, def.mapId)

  const spawn = entryCell ? cellToWorld(entryCell) : map.playerSpawn
  const arrivalCell = entryCell ?? {
    col: Math.round(map.playerSpawn.x / 2),
    row: Math.round(map.playerSpawn.z / 2),
  }
  player.transform.position.x = spawn.x
  player.transform.position.z = spawn.z
  player.transform.yaw = 0
  resetCompanions(world, player)

  spawnDestructibles(world, map, def.mapId)
  for (const spawnPoint of map.spawns) {
    spawnEnemy(world, spawnPoint.kind, spawnPoint.x, spawnPoint.z, spawnPoint.isElite)
  }
  spawnBoss(world, map, def)

  // 모든 진입 경로(물리 출구·문지기·NPC·개발 훅)에서 도착 칸을 잠근다.
  // 보스 맵은 P와 귀환 출구가 같은 칸일 수 있어, 이 보호가 없으면 진입 즉시 되돌아간다.
  runtime.blockedExit = {
    zoneId: targetZoneId,
    exit: { targetZoneId: previousZoneId, label: "arrival", fromCell: arrivalCell },
  }

  res.hud.setBossBar(null)
  res.hud.setBossBreak(null, false, false)
  res.hud.setOverlay(null)
  return true
}

function distanceToCell(pos: Vec2, cell: { col: number; row: number }): number {
  const target = cellToWorld(cell)
  return Math.hypot(pos.x - target.x, pos.z - target.z)
}

function physicalExit(zone: ZoneDefinition, pos: Vec2, runtime: ZoneRuntime): ZoneExit | null {
  if (runtime.blockedExit?.zoneId === zone.id) {
    const blocked = runtime.blockedExit.exit
    if (blocked.fromCell && distanceToCell(pos, blocked.fromCell) > EXIT_RELEASE_RADIUS) runtime.blockedExit = null
    else return null
  }
  return zone.exits.find((exit) => !exit.interactionOnly && exit.fromCell && distanceToCell(pos, exit.fromCell) <= EXIT_RADIUS) ?? null
}

export function zoneSystem(world: GameWorld, res: Resources, runtime: ZoneRuntime, dt: number): void {
  void dt
  const player = world.with("player", "transform", "health").entities[0]
  if (!player || player.dead) return
  if (res.time.now < runtime.transitionLockUntil) return

  if (res.input.returnTownQueued) {
    res.input.returnTownQueued = false
    if (runtime.currentZoneId !== "town") runtime.requestedZoneId = "town"
  }

  if (runtime.requestedZoneId) {
    if (!enterZone(world, res, runtime, runtime.requestedZoneId)) runtime.requestedZoneId = null
    return
  }

  const zone = getZone(runtime.currentZoneId)
  if (!zone) return
  const exit = physicalExit(zone, player.transform.position, runtime)
  if (!exit) return
  if (enterZone(world, res, runtime, exit.targetZoneId, exit.entryCell)) {
    // enterZone이 도착 칸 기준으로 모든 경로를 공통 무장한다.
  }
}
