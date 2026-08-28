import * as THREE from "three"
import { ENEMY_DEFS } from "../content/enemies"
import type { BossComp, BossPhase, GameWorld, Resources, Vec2 } from "../core/world"
import { dealDamage, meleeStrike, pointInPath } from "./combat"
import { applyKnockback } from "./movement"
import { shakeCamera } from "./render"
import { beginBreakWindow } from "./break"
import { selectPartyTarget } from "./party"
import { MINE_BOSS_PATTERNS, selectPattern, type PatternDef } from "../content/patterns"
import { spawnEnemy } from "../content/enemies"

export const BOSS = {
  slam: { telegraph: 1.4, radius: 3.5, damage: 25, count: 3, interval: 1.8 },
  charge: { telegraph: 1.4, speed: 18, halfWidth: 1.2, damage: 30, maxDist: 12 },
  /**
   * 패턴 사이 간격. 4초였을 때 한 사이클이 예고+발동까지 5.5초라, 한 판에 패턴이
   * **두 종류밖에 안 나왔다.** 다섯 개를 만들어 두고 둘만 보여 주면 없는 것과 같다.
   * 액션 게임의 보스는 2~3초에 한 번 움직인다.
   */
  patternCooldown: 2.2,
} as const


/**
 * 패턴 id → 예고 페이즈 이름. 패턴을 추가할 때 여기만 늘리면 된다.
 *
 * 예전에는 `rngPick < 0.5 ? "slamTelegraph" : "chargeTelegraph"` 로 두 개를 반반 골랐다.
 * 그래서 **패턴 계약(`content/patterns.ts`)이 우선순위·가중치·조건까지 갖춰 놓고도
 * 전혀 쓰이지 않았다.** 이제 `selectPattern` 이 고르고 여기서 페이즈로 옮긴다.
 */
const TELEGRAPH_PHASE: Record<string, BossPhase> = {
  slam: "slamTelegraph",
  charge: "chargeTelegraph",
  sweep: "sweepTelegraph",
  summon: "summonTelegraph",
  quake: "quakeTelegraph",
}

const PATTERN_BY_ID = new Map(MINE_BOSS_PATTERNS.map((p) => [p.id, p]))

function patternOf(id: string | undefined): PatternDef | undefined {
  return id ? PATTERN_BY_ID.get(id) : undefined
}

/** 살아 있는 하수인 수. 소환 패턴의 조건이 이 값을 본다. */
function liveMinions(boss: BossComp): number {
  if (!boss.minions) return 0
  boss.minions = boss.minions.filter((m) => !m.dead)
  return boss.minions.length
}

/** 페이즈 전이 결정(순수). null이면 유지. 부수효과는 bossSystem이 담당. */
export function nextBossPhase(
  boss: BossComp,
  now: number,
  rngPick: number,
  ctx: { healthFraction: number; summonCount: number } = { healthFraction: 1, summonCount: 0 },
): BossPhase | null {
  switch (boss.phase) {
    case "idle": {
      if (!boss.engaged || now < boss.nextPatternAt) return null
      const picked = selectPattern(MINE_BOSS_PATTERNS, {
        healthFraction: ctx.healthFraction,
        summonCount: ctx.summonCount,
        previousPatternId: boss.lastPatternId,
      }, rngPick)
      if (!picked) return null
      boss.lastPatternId = picked.id
      return TELEGRAPH_PHASE[picked.id] ?? "slamTelegraph"
    }
    case "slamTelegraph":
      return now >= boss.phaseUntil ? "slamming" : null
    case "slamming":
      if (now < boss.phaseUntil) return null
      // 내려찍기만 연타한다. 다른 패턴은 한 번으로 끝난다.
      return boss.slamCount < (patternOf("slam")?.repeatCount ?? 3) ? "slamTelegraph" : "idle"
    case "chargeTelegraph":
      return now >= boss.phaseUntil ? "charging" : null
    case "charging":
      return now >= boss.phaseUntil ? "idle" : null
    case "sweepTelegraph":
      return now >= boss.phaseUntil ? "sweeping" : null
    case "sweeping":
      return now >= boss.phaseUntil ? "idle" : null
    case "summonTelegraph":
      return now >= boss.phaseUntil ? "summoning" : null
    case "summoning":
      return now >= boss.phaseUntil ? "idle" : null
    case "quakeTelegraph":
      return now >= boss.phaseUntil ? "quaking" : null
    case "quaking":
      return now >= boss.phaseUntil ? "idle" : null
  }
}

// 텔레그래프 시각 표시 (모듈 상태 — 보스는 1기)
let slamMesh: THREE.Mesh | null = null
let chargeMesh: THREE.Mesh | null = null
let sweepMesh: THREE.Mesh | null = null
let quakeMesh: THREE.Mesh | null = null
let safeMesh: THREE.Mesh | null = null
let slamTarget: Vec2 = { x: 0, z: 0 }

function showSlamTelegraph(res: Resources, at: Vec2) {
  clearTelegraphs(res)
  slamMesh = new THREE.Mesh(new THREE.CircleGeometry(BOSS.slam.radius, 32), telegraphMat(0.46))
  layFlat(slamMesh, at)
  res.scene.add(slamMesh)
}

function showChargeTelegraph(res: Resources, origin: Vec2, dir: Vec2) {
  clearTelegraphs(res)
  chargeMesh = new THREE.Mesh(new THREE.PlaneGeometry(BOSS.charge.halfWidth * 2, BOSS.charge.maxDist), telegraphMat(0.42))
  layFlat(chargeMesh, {
    x: origin.x + (dir.x * BOSS.charge.maxDist) / 2,
    z: origin.z + (dir.z * BOSS.charge.maxDist) / 2,
  })
  chargeMesh.rotation.z = -Math.atan2(dir.x, dir.z)
  res.scene.add(chargeMesh)
}

/**
 * 부채꼴 예고. 원과 달리 **뒤가 안전하다** — 돌아 들어가는 선택지를 만드는 게 이 패턴의 전부다.
 */
function showSweepTelegraph(res: Resources, origin: Vec2, yaw: number, range: number, halfAngle: number) {
  clearTelegraphs(res)
  const geo = new THREE.CircleGeometry(range, 28, -halfAngle + Math.PI / 2, halfAngle * 2)
  sweepMesh = new THREE.Mesh(geo, telegraphMat(0.46))
  layFlat(sweepMesh, origin)
  sweepMesh.rotation.z = yaw
  res.scene.add(sweepMesh)
}

/**
 * 균열 예고 — **가운데가 안전하다**. 내려찍기와 정반대라 색도 다르게 준다.
 * 같은 붉은 원으로 그리면 플레이어가 반사적으로 밖으로 뛰어 나가 그대로 맞는다.
 */
function showQuakeTelegraph(res: Resources, origin: Vec2, safeRadius: number) {
  clearTelegraphs(res)
  quakeMesh = new THREE.Mesh(new THREE.RingGeometry(safeRadius, safeRadius + 14, 40), telegraphMat(0.4, 0xff6a12))
  layFlat(quakeMesh, origin, 0.08)
  res.scene.add(quakeMesh)
  // 안전지대를 초록으로 따로 칠한다. "여기 서라" 를 색으로 말한다.
  safeMesh = new THREE.Mesh(new THREE.CircleGeometry(safeRadius, 32), telegraphMat(0.34, 0x3ce87a))
  layFlat(safeMesh, origin, 0.1)
  res.scene.add(safeMesh)
}

/**
 * 예고 재질.
 *
 * 처음엔 `0xcc2222` 에 불투명도 0.3 이었는데, ACES 톤 매핑이 들어온 뒤로 밝은 흙바닥
 * 위에서 **창백하게 뜨고 형태가 안 읽혔다.** 예고를 못 읽으면 패턴이 아무리 많아도
 * 그냥 무작위로 맞는 것과 같다.
 *
 * 채도가 높은 주홍으로 올리고 불투명도를 키운다. 바닥 자국(decals)과 같은 평면이라
 * `renderOrder` 로 위에 얹고 폴리곤 오프셋으로 z-파이팅을 막는다.
 */
function telegraphMat(opacity: number, color = 0xff3a22) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  })
}

/** 모든 예고 메시가 같은 규칙을 따르게 한다 — 눕히고, 바닥 자국 위에 얹는다. */
function layFlat(mesh: THREE.Mesh, at: Vec2, y = 0.09): void {
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(at.x, y, at.z)
  mesh.renderOrder = 2
  mesh.castShadow = false
  mesh.receiveShadow = false
}

function clearTelegraphs(res: Resources) {
  if (slamMesh) {
    res.scene.remove(slamMesh)
    slamMesh = null
  }
  if (chargeMesh) {
    res.scene.remove(chargeMesh)
    chargeMesh = null
  }
  for (const m of [sweepMesh, quakeMesh, safeMesh]) if (m) res.scene.remove(m)
  sweepMesh = null
  quakeMesh = null
  safeMesh = null
}

export function bossSystem(world: GameWorld, res: Resources, dt: number): void {
  void dt
  const now = res.time.now
  const bossEntity = world.with("boss", "enemy", "transform", "health").entities[0]
  if (!bossEntity || bossEntity.dead) {
    res.hud.setBossBreak(null, false, false)
    return
  }
  const b = bossEntity.boss
  const bp = bossEntity.transform.position
  const def = ENEMY_DEFS.boss

  const target = selectPartyTarget(world, bossEntity)
  const playerAlive = !!target
  const pp = target?.transform?.position
  const distToPlayer = pp ? Math.hypot(pp.x - bp.x, pp.z - bp.z) : Infinity

  // 조우 시작
  if (!b.engaged && playerAlive && distToPlayer < def.aggroRange) {
    b.engaged = true
    b.nextPatternAt = now + 1.5
  }
  res.hud.setBossBar(b.engaged ? bossEntity.health.current : null, bossEntity.health.max)
  if (!b.engaged) {
    res.hud.setBossBreak(null, false, false)
    return
  }

  // 브레이크 성공 후에는 현재 패턴을 취소하고 무력화 시간 동안 행동하지 않는다.
  if (bossEntity.breakable?.brokenUntil && bossEntity.breakable.brokenUntil > now) {
    b.phase = "idle"
    b.slamCount = 0
    b.nextPatternAt = Math.max(b.nextPatternAt, bossEntity.breakable.brokenUntil + 1.5)
    clearTelegraphs(res)
    if (bossEntity.moveTarget) world.removeComponent(bossEntity, "moveTarget")
    res.hud.setBossBreak(0, false, true)
    return
  }
  if (bossEntity.stunned) {
    if (bossEntity.moveTarget) world.removeComponent(bossEntity, "moveTarget")
    res.hud.setBossBreak(bossEntity.breakable?.current ?? null, false, true)
    return
  }
  if (bossEntity.hitstun && now < bossEntity.hitstun.until) {
    if (bossEntity.moveTarget) world.removeComponent(bossEntity, "moveTarget")
    res.hud.setBossBreak(bossEntity.breakable?.current ?? null, false, false)
    return
  }
  if (bossEntity.hitstun) world.removeComponent(bossEntity, "hitstun")

  // 페이즈 전이 + 부수효과
  const next = nextBossPhase(b, now, res.rng(), {
    healthFraction: bossEntity.health.current / bossEntity.health.max,
    summonCount: liveMinions(b),
  })
  if (next) {
    b.phase = next
    switch (next) {
      case "slamTelegraph": {
        if (pp) slamTarget = { x: pp.x, z: pp.z }
        b.phaseUntil = now + BOSS.slam.telegraph
        if (bossEntity.breakable) beginBreakWindow(bossEntity.breakable, now, BOSS.slam.telegraph)
        showSlamTelegraph(res, slamTarget)
        break
      }
      case "slamming": {
        clearTelegraphs(res)
        b.slamCount += 1
        b.phaseUntil = now + (BOSS.slam.interval - BOSS.slam.telegraph)
        shakeCamera(res)
        if (target && playerAlive && pp) {
          const d = Math.hypot(pp.x - slamTarget.x, pp.z - slamTarget.z)
          if (d <= BOSS.slam.radius + (target.radius ?? 0.45)) {
            dealDamage(world, res, bossEntity, target, BOSS.slam.damage)
          }
        }
        break
      }
      case "chargeTelegraph": {
        if (pp) {
          const len = distToPlayer || 1
          b.chargeDir = { x: (pp.x - bp.x) / len, z: (pp.z - bp.z) / len }
        }
        b.phaseUntil = now + BOSS.charge.telegraph
        if (bossEntity.breakable) beginBreakWindow(bossEntity.breakable, now, BOSS.charge.telegraph)
        if (bossEntity.moveTarget) world.removeComponent(bossEntity, "moveTarget")
        showChargeTelegraph(res, bp, b.chargeDir)
        break
      }
      case "charging": {
        clearTelegraphs(res)
        const duration = BOSS.charge.maxDist / BOSS.charge.speed
        b.phaseUntil = now + duration
        applyKnockback(world, bossEntity, b.chargeDir, BOSS.charge.speed, now + duration)
        if (target && playerAlive && pp && pointInPath(bp, b.chargeDir, BOSS.charge.halfWidth, BOSS.charge.maxDist, pp, target.radius ?? 0.45)) {
          dealDamage(world, res, bossEntity, target, BOSS.charge.damage)
          const side = { x: b.chargeDir.z, z: -b.chargeDir.x }
          applyKnockback(world, target, side, 10, now + 0.2)
        }
        break
      }
      case "sweepTelegraph": {
        const p = patternOf("sweep")!
        if (pp) bossEntity.transform.yaw = Math.atan2(pp.x - bp.x, pp.z - bp.z)
        b.phaseUntil = now + p.telegraph
        if (bossEntity.breakable) beginBreakWindow(bossEntity.breakable, now, p.telegraph)
        if (bossEntity.moveTarget) world.removeComponent(bossEntity, "moveTarget")
        showSweepTelegraph(res, bp, bossEntity.transform.yaw, p.range ?? 6.5, Number(p.parameters?.halfAngle ?? 1.05))
        break
      }
      case "sweeping": {
        clearTelegraphs(res)
        const p = patternOf("sweep")!
        b.phaseUntil = now + 0.35
        shakeCamera(res, 0.18)
        if (target && pp) {
          // 부채꼴 안인지: 거리와 각도를 모두 본다. 뒤로 돌아간 플레이어는 안 맞는다.
          const d = Math.hypot(pp.x - bp.x, pp.z - bp.z)
          const toPlayer = Math.atan2(pp.x - bp.x, pp.z - bp.z)
          let diff = Math.abs(toPlayer - bossEntity.transform.yaw)
          if (diff > Math.PI) diff = Math.PI * 2 - diff
          if (d <= (p.range ?? 6.5) + (target.radius ?? 0.45) && diff <= Number(p.parameters?.halfAngle ?? 1.05)) {
            dealDamage(world, res, bossEntity, target, p.damage)
            const away = { x: (pp.x - bp.x) / (d || 1), z: (pp.z - bp.z) / (d || 1) }
            applyKnockback(world, target, away, 9, now + 0.18)
          }
        }
        break
      }
      case "summonTelegraph": {
        const p = patternOf("summon")!
        b.phaseUntil = now + p.telegraph
        if (bossEntity.breakable) beginBreakWindow(bossEntity.breakable, now, p.telegraph)
        if (bossEntity.moveTarget) world.removeComponent(bossEntity, "moveTarget")
        showSlamTelegraph(res, { x: bp.x, z: bp.z })
        break
      }
      case "summoning": {
        clearTelegraphs(res)
        const p = patternOf("summon")!
        b.phaseUntil = now + 0.4
        shakeCamera(res, 0.14)
        b.minions ??= []
        // 보스를 둘러싸고 나온다. 한쪽에 몰아 두면 그냥 반대편으로 걸어가면 그만이다.
        const count = p.repeatCount ?? 3
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2 + res.rng() * 0.4
          const r = 2.6
          const m = spawnEnemy(world, "charger", bp.x + Math.cos(a) * r, bp.z + Math.sin(a) * r)
          m.enemy!.state = "chase"
          b.minions.push(m)
        }
        break
      }
      case "quakeTelegraph": {
        const p = patternOf("quake")!
        b.phaseUntil = now + p.telegraph
        if (bossEntity.breakable) beginBreakWindow(bossEntity.breakable, now, p.telegraph)
        if (bossEntity.moveTarget) world.removeComponent(bossEntity, "moveTarget")
        showQuakeTelegraph(res, bp, p.radius ?? 3.2)
        break
      }
      case "quaking": {
        clearTelegraphs(res)
        const p = patternOf("quake")!
        b.phaseUntil = now + 0.5
        shakeCamera(res, 0.34)
        if (target && pp) {
          // **안전지대가 보스 곁이다.** 내려찍기와 정반대 — 밖에 있으면 맞는다.
          const d = Math.hypot(pp.x - bp.x, pp.z - bp.z)
          if (d > (p.radius ?? 3.2)) dealDamage(world, res, bossEntity, target, p.damage)
        }
        break
      }
      case "idle": {
        b.slamCount = 0
        b.nextPatternAt = now + BOSS.patternCooldown
        break
      }
    }
  }

  res.hud.setBossBreak(
    bossEntity.breakable ? bossEntity.breakable.current / bossEntity.breakable.max : null,
    !!bossEntity.breakable && bossEntity.breakable.exposedUntil > now,
    false,
  )

  // 텔레그래프 중에는 정지, idle 페이즈에는 일반 추적/근접
  const HOLDING: BossPhase[] = [
    "slamTelegraph", "chargeTelegraph", "slamming",
    "sweepTelegraph", "sweeping", "summonTelegraph", "summoning",
    "quakeTelegraph", "quaking",
  ]
  if (HOLDING.includes(b.phase)) {
    if (bossEntity.moveTarget) world.removeComponent(bossEntity, "moveTarget")
    if (pp) bossEntity.transform.yaw = Math.atan2(pp.x - bp.x, pp.z - bp.z)
  } else if (b.phase === "idle" && playerAlive && pp) {
    if (distToPlayer > def.attackRange) {
      if (bossEntity.moveTarget) {
        bossEntity.moveTarget.x = pp.x
        bossEntity.moveTarget.z = pp.z
      } else {
        world.addComponent(bossEntity, "moveTarget", { x: pp.x, z: pp.z })
      }
    } else {
      if (bossEntity.moveTarget) world.removeComponent(bossEntity, "moveTarget")
      bossEntity.transform.yaw = Math.atan2(pp.x - bp.x, pp.z - bp.z)
      if (bossEntity.attack && now >= bossEntity.attack.readyAt && target) {
        bossEntity.attack.readyAt = now + bossEntity.attack.cooldown
        meleeStrike(world, res, bossEntity, [target])
      }
    }
  }
}
