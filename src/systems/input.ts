import * as THREE from "three"
import type { Entity, GameWorld, InputEventQueue, Resources, Vec2 } from "../core/world"
import { refreshInventory } from "./loot"
import { worldToScreen } from "./render"
import { grabEnemyNear } from "./targeting"
import { toggleFullMap } from "../ui/minimap"
import { toggleSkillsPanel, toggleStatsPanel } from "../ui/panels"

export function bindInput(canvas: HTMLElement): InputEventQueue {
  const q: InputEventQueue = {
    clicks: [],
    dashQueued: false,
    skillQueued: null,
    pointer: { ndcX: 0, ndcY: 0 },
    toggleInventory: false,
    toggleMap: false,
    toggleStats: false,
    toggleSkills: false,
    zoomDelta: 0,
    rotateCamera: 0,
    pitchCamera: 0,
    returnTownQueued: false,
    interactQueued: false,
    held: new Set<string>(),
  }
  const toNdc = (ev: MouseEvent) => ({
    ndcX: (ev.clientX / window.innerWidth) * 2 - 1,
    ndcY: -(ev.clientY / window.innerHeight) * 2 + 1,
  })
  window.addEventListener("mousemove", (ev) => {
    q.pointer = toNdc(ev)
  })
  canvas.addEventListener("mousedown", (ev) => {
    const { ndcX, ndcY } = toNdc(ev)
    q.clicks.push({ ndcX, ndcY, button: ev.button === 2 ? 2 : 0 })
  })
  canvas.addEventListener("wheel", (ev) => {
    q.zoomDelta += ev.deltaY
    ev.preventDefault()
  }, { passive: false })
  window.addEventListener("contextmenu", (ev) => ev.preventDefault())
  window.addEventListener("keydown", (ev) => {
    if (ev.code === "Space") {
      q.dashQueued = true
      ev.preventDefault()
    }
    if (ev.code === "Digit3") {
      q.skillQueued = "guard"
      ev.preventDefault()
    }
    if (ev.code === "Digit4") {
      q.skillQueued = "execution"
      ev.preventDefault()
    }
    if (ev.code === "KeyI") q.toggleInventory = true
    if (ev.code === "KeyM") q.toggleMap = true
    if (ev.code === "KeyC") q.toggleStats = true
    if (ev.code === "KeyK") q.toggleSkills = true
    if (ev.code === "KeyQ") q.rotateCamera -= 1
    if (ev.code === "KeyR") q.rotateCamera += 1
    if (ev.code === "KeyZ") q.pitchCamera -= 1
    if (ev.code === "KeyX") q.pitchCamera += 1
    if (ev.code === "KeyT") {
      q.returnTownQueued = true
      ev.preventDefault()
    }
    if (ev.code === "KeyE") {
      q.interactQueued = true
      ev.preventDefault()
    }
    if (MOVE_KEYS.has(ev.code)) {
      q.held.add(ev.code)
      ev.preventDefault() // 방향키가 페이지를 스크롤하지 않도록
    }
  })
  window.addEventListener("keyup", (ev) => {
    q.held.delete(ev.code)
  })
  // 창이 포커스를 잃으면 키가 눌린 채로 남아 캐릭터가 계속 걸어간다
  window.addEventListener("blur", () => q.held.clear())
  return q
}

/** 직접 이동에 쓰는 키. WASD 와 방향키를 모두 받는다. */
export const MOVE_KEYS = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD",
  "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight",
])

const raycaster = new THREE.Raycaster()
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const ndc = new THREE.Vector2()
const hitPoint = new THREE.Vector3()

function pickEntity(res: Resources, ndcX: number, ndcY: number): Entity | null {
  ndc.set(ndcX, ndcY)
  raycaster.setFromCamera(ndc, res.camera)
  const hits = raycaster.intersectObjects(res.scene.children, true)
  for (const h of hits) {
    let o: THREE.Object3D | null = h.object
    while (o) {
      const ent = o.userData.entity as Entity | undefined
      if (ent) return ent
      o = o.parent
    }
    return null // 가장 가까운 히트가 벽/바닥이면 지면 클릭으로 처리
  }
  return null
}

export function groundPoint(res: Resources, ndcX: number, ndcY: number): Vec2 | null {
  ndc.set(ndcX, ndcY)
  raycaster.setFromCamera(ndc, res.camera)
  if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
    return { x: hitPoint.x, z: hitPoint.z }
  }
  return null
}

function setComponent<K extends keyof Entity>(world: GameWorld, e: Entity, key: K, value: NonNullable<Entity[K]>) {
  if (e[key] !== undefined) world.removeComponent(e, key)
  world.addComponent(e, key, value)
}

export function inputSystem(world: GameWorld, res: Resources): void {
  const player = world.with("player", "transform").entities[0]
  if (!player) return

  const q = res.input

  if (q.toggleMap) {
    q.toggleMap = false
    toggleFullMap()
  }

  if (q.toggleStats) {
    q.toggleStats = false
    toggleStatsPanel()
  }

  if (q.toggleSkills) {
    q.toggleSkills = false
    toggleSkillsPanel()
  }

  if (q.toggleInventory) {
    q.toggleInventory = false
    refreshInventory(world, res)
    res.hud.toggleInventory()
  }

  if (player.dead) {
    q.clicks.length = 0
    q.dashQueued = false
    q.skillQueued = null
    q.interactQueued = false
    return
  }

  if (q.skillQueued) {
    const skill = q.skillQueued
    q.skillQueued = null
    const point = groundPoint(res, q.pointer.ndcX, q.pointer.ndcY)
      ?? { x: player.transform.position.x, z: player.transform.position.z }
    setComponent(world, player, "skillIntent", { skill, point })
  }

  for (const click of q.clicks) {
    if (click.button === 0) {
      const target = pickEntity(res, click.ndcX, click.ndcY)
      const point = groundPoint(res, click.ndcX, click.ndcY)
      // 전리품을 직접 찍은 경우는 그대로 둔다 — 줍겠다는 뜻이 명확하다
      if (target && target.lootDrop) {
        const p = target.transform!.position
        setComponent(world, player, "moveTarget", { x: p.x, z: p.z })
        if (player.attackIntent) world.removeComponent(player, "attackIntent")
        continue
      }
      // 정확히 찍은 적이 우선, 없으면 근처 적을 관대하게 잡는다
      const enemy =
        target && ((target.enemy && !target.dead) || (target.destructible?.state === "intact"))
          ? target
          : grabEnemyNear(world, player, {
              x: ((click.ndcX + 1) / 2) * window.innerWidth,
              y: ((1 - click.ndcY) / 2) * window.innerHeight,
            }, point, (x, y, z) => worldToScreen(res, x, y, z))
      if (enemy) {
        setComponent(world, player, "attackIntent", { target: enemy })
        if (player.moveTarget) world.removeComponent(player, "moveTarget")
      } else if (point) {
        setComponent(world, player, "moveTarget", point)
        if (player.attackIntent) world.removeComponent(player, "attackIntent")
      }
    } else {
      const point = groundPoint(res, click.ndcX, click.ndcY)
      if (point) setComponent(world, player, "skillIntent", { skill: "whirlwind", point })
    }
  }
  q.clicks.length = 0

  if (q.dashQueued) {
    q.dashQueued = false
    const point = groundPoint(res, q.pointer.ndcX, q.pointer.ndcY)
    if (point) setComponent(world, player, "skillIntent", { skill: "dash", point })
  }
}
