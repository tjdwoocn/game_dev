import * as THREE from "three"
import type { Entity, GameWorld, Resources } from "../core/world"

type AnimName = "idle" | "walk" | "attack" | "death"

interface AnimState {
  mixer: THREE.AnimationMixer
  actions: Partial<Record<AnimName, THREE.AnimationAction>>
  current?: AnimName
}

const animStates = new WeakMap<THREE.Object3D, AnimState>()

const CLIP_PATTERNS: Record<AnimName, RegExp[]> = {
  idle: [/^idle$/i, /idle/i],
  walk: [/walking_a/i, /^walk/i, /walk/i, /run/i],
  attack: [/1h_melee_attack_chop/i, /melee_attack/i, /attack/i],
  death: [/death_a$/i, /death/i],
}

function pickClip(clips: THREE.AnimationClip[], patterns: RegExp[]): THREE.AnimationClip | undefined {
  for (const p of patterns) {
    const clip = clips.find((c) => p.test(c.name))
    if (clip) return clip
  }
  return undefined
}

/** glTF 모델 인스턴스에 믹서를 부착. render의 모델 생성 시점에 호출된다. */
export function attachAnimations(root: THREE.Object3D, clips: THREE.AnimationClip[]): void {
  const mixer = new THREE.AnimationMixer(root)
  const actions: AnimState["actions"] = {}
  for (const name of Object.keys(CLIP_PATTERNS) as AnimName[]) {
    const clip = pickClip(clips, CLIP_PATTERNS[name])
    if (clip) {
      const action = mixer.clipAction(clip)
      if (name === "death") {
        action.setLoop(THREE.LoopOnce, 1)
        action.clampWhenFinished = true
      }
      actions[name] = action
    }
  }
  animStates.set(root, { mixer, actions })
}

/** 공격 모션 표시 구간: 마지막 공격 시점부터 0.4초 */
function isAttacking(e: Entity, now: number): boolean {
  if (!e.attack) return false
  const lastAt = e.attack.readyAt - e.attack.cooldown
  const sinceAttack = now - lastAt
  return sinceAttack >= 0 && sinceAttack < 0.4 && e.attack.readyAt > now
}

function desiredAnim(e: Entity, now: number): AnimName {
  if (e.dead) return "death"
  if (isAttacking(e, now)) return "attack"
  if (e.moveTarget || (e.knockback && now < e.knockback.until)) return "walk"
  return "idle"
}

export function animationSystem(world: GameWorld, res: Resources, dt: number): void {
  const now = res.time.now
  for (const e of world.with("transform", "model")) {
    const obj = e.model.object
    if (!obj) continue

    // glTF 모델: 믹서는 래퍼 그룹의 첫 자식(모델 루트)에 붙어 있다
    const modelRoot = obj.children[0]
    const st = modelRoot ? animStates.get(modelRoot) : undefined
    if (st) {
      const target = desiredAnim(e, now)
      if (st.current !== target && st.actions[target]) {
        const prev = st.current ? st.actions[st.current] : undefined
        st.actions[target]!.reset().fadeIn(0.15).play()
        prev?.fadeOut(0.15)
        st.current = target
      }
      st.mixer.update(dt)
    } else if (!e.lootDrop && !e.projectile) {
      // 프리미티브 폴백: 공격 시 짧게 앞으로 기울인다
      obj.rotation.x = isAttacking(e, now) ? 0.28 : 0
    }
  }
}
