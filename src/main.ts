import { createLoop } from "./core/loop"
import { advanceHitstop, createHitstop } from "./core/hitstop"
import { createWorld, type Entity, type Resources } from "./core/world"
import { mulberry32 } from "./core/rng"
import { createGameplayEventBuffer } from "./core/events"
import { parseMap } from "./content/map"
import { MAP_LAYOUTS } from "./content/maps"
import { spawnEnemy } from "./content/enemies"
import { spawnCompanion } from "./content/companions"
import { PARTY_CONFIG } from "./content/party"
import { aiSystem } from "./systems/ai"
import { combatSystem } from "./systems/combat"
import { skillsSystem } from "./systems/skills"
import { lootSystem } from "./systems/loot"
import { progressionSystem } from "./systems/progression"
import { bossSystem } from "./systems/boss"
import { breakSystem } from "./systems/break"
import { partySystem } from "./systems/party"
import { autoplaySystem, isAutoplayEnabled } from "./dev/autoplay"
import { loadModelRegistry } from "./core/assets"
import { buildMapMeshes, initRender, renderFrame, renderSystem, setModelRegistry, worldToScreen } from "./systems/render"
import { feedbackSystem } from "./systems/feedback"
import { animationSystem } from "./systems/animation"
import { loadDungeonKit } from "./systems/dungeonDressing"
import { directMoveSystem } from "./systems/directMove"
import { bindInput, inputSystem } from "./systems/input"
import { movementSystem } from "./systems/movement"
import { createHud } from "./ui/hud"
import { updateMinimap } from "./ui/minimap"
import { updatePanels } from "./ui/panels"
import { updateHitDirection } from "./ui/hitDirection"
import { createZoneRuntime, enterZone, zoneSystem } from "./systems/zone"
import { townSystem } from "./systems/town"

const mount = document.getElementById("game")!
setModelRegistry(await loadModelRegistry())
await loadDungeonKit()
const { scene, camera, renderer } = initRender(mount)
function seedFromQuery(): number | null {
  const raw = new URLSearchParams(window.location.search).get("seed")
  if (raw === null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n >>> 0 : null
}
const initialMap = parseMap(MAP_LAYOUTS.town!)

const world = createWorld()
const res: Resources = {
  scene,
  camera,
  renderer,
  input: bindInput(renderer.domElement),
  time: { now: 0, realNow: 0 },
  hitstop: createHitstop(),
  events: createGameplayEventBuffer(),
  // `?seed=N` 을 주면 난수를 고정한다. **스크린샷 계약(tools/playtest/views.mjs)이
  // 같은 장면을 매번 같게 잡으려면 필요하다** — 드랍 등급이나 적 배회가 매번 달라지면
  // 두 시점의 화면을 나란히 놓고 비교할 수 없다. 평소 플레이에는 영향이 없다.
  rng: mulberry32(seedFromQuery() ?? (Date.now() >>> 0)),
  map: initialMap,
  zoneId: "town",
  hud: createHud(),
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
for (const role of PARTY_CONFIG.activeCompanionRoles) {
  const offset = PARTY_CONFIG.formation[role]
  spawnCompanion(
    world,
    role,
    player.transform!.position.x + offset.x,
    player.transform!.position.z + offset.z,
    offset,
  )
}
const zoneRuntime = createZoneRuntime("town")
enterZone(world, res, zoneRuntime, "town")

// 개발/플레이테스트 하니스용 관측 핸들 (읽기 전용으로만 쓴다)
;(window as unknown as Record<string, unknown>).__game = {
  world,
  res,
  player,
  zoneRuntime,
  transitionTo: (zoneId: string) => enterZone(world, res, zoneRuntime, zoneId),
  screenOf: (x: number, y: number, z: number) => worldToScreen(res, x, y, z),
}


const autoplay = isAutoplayEnabled()

function logic(realDt: number) {
  res.time.realNow += realDt
  const dt = advanceHitstop(res.hitstop, realDt)
  res.time.now += dt
  if (autoplay) autoplaySystem(world, res, dt)
  inputSystem(world, res)
  directMoveSystem(world, res, dt) // WASD 는 클릭 이동보다 우선한다
  aiSystem(world, res, dt)
  partySystem(world, res, dt)
  breakSystem(world, res, dt)
  bossSystem(world, res, dt)
  skillsSystem(world, res, dt)
  movementSystem(world, res, dt)
  combatSystem(world, res, dt)
  lootSystem(world, res, dt)
  progressionSystem(world, res, dt)
  animationSystem(world, res, dt)
  townSystem(world, res, zoneRuntime, dt)
  zoneSystem(world, res, zoneRuntime, dt)
  feedbackSystem(world, res) // 상태 변화를 관측해 소리·이펙트를 낸다. 다른 시스템을 고치지 않는다
}

createLoop(logic, () => {
  renderSystem(world, res)
  updateMinimap(world, res)
  updatePanels(world)
  updateHitDirection()
  renderFrame(scene, camera)
}).start()
