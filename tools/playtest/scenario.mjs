/**
 * 시나리오 러너 — "실제로 플레이해서 여기까지 됐다"를 결정론적으로 판정한다.
 *
 * Tesserack(공략을 결정론적 보상 체크로 미리 컴파일)의 아이디어를 빌려,
 * 플레이 진행도를 3단계 체크포인트로 정의한다:
 *   micro     — 입력이 먹혔는가 (클릭하면 움직이는가)
 *   landmark  — 중간 목표에 도달했는가 (첫 처치, 아이템 획득, 방 진입)
 *   objective — 최종 목표를 달성했는가 (보스 처치, 던전 클리어)
 *
 * 각 체크포인트는 관측 스냅샷만 보고 통과/실패를 판정하므로,
 * "스크린샷 보니 그럴듯하다" 수준이 아니라 근거가 남는다.
 */

/** @typedef {{id:string, tier:'micro'|'landmark'|'objective', desc:string, check:(o:any, ctx:any)=>boolean}} Checkpoint */

/** @type {Checkpoint[]} */
export const CHECKPOINTS = [
  {
    id: "boots",
    tier: "micro",
    desc: "게임이 로드되고 플레이어가 살아있다",
    check: (o) => o.ready && !o.player.dead && o.player.hp > 0,
  },
  {
    id: "no-console-errors",
    tier: "micro",
    desc: "콘솔 에러가 없다",
    check: (o) => o.consoleErrors.length === 0,
  },
  {
    id: "moved",
    tier: "micro",
    desc: "플레이어가 시작 지점에서 이동했다",
    check: (o, ctx) =>
      ctx.startPos && Math.hypot(o.player.world.x - ctx.startPos.x, o.player.world.z - ctx.startPos.z) > 1.5,
  },
  {
    id: "player-visible",
    tier: "micro",
    desc: "플레이어 모델이 화면에 보인다",
    check: (o) => o.player.screen.onScreen,
  },
  {
    // 인원 수의 기준은 src/content/party.ts 의 PARTY_CONFIG 다.
    // 현재는 플레이어 1 + 동료 1 이고 구조상 최대 3인(= 동료 2)까지 늘어난다.
    // 여기서는 그 범위 안에 있는지만 본다 — 정확한 인원은 설계 변경에 따라 바뀐다.
    id: "party-present",
    tier: "landmark",
    desc: "동료가 파티에 합류했다 (플레이어 포함 최대 3인 구조)",
    check: (o) => Array.isArray(o.party) && o.party.length >= 1 && o.party.length <= 2,
  },
  {
    id: "party-follow",
    tier: "landmark",
    desc: "동료가 낙오하거나 끼이지 않고 따라다녔다",
    check: (_o, ctx) => ctx.maxCompanionGap !== null && ctx.maxCompanionGap < 30,
  },
  {
    id: "first-kill",
    tier: "landmark",
    desc: "적을 1기 이상 처치했다 (경험치 획득)",
    check: (o, ctx) => o.player.xp > 0 || o.player.level > 1 || ctx.everKilled,
  },
  {
    id: "loot-pickup",
    tier: "landmark",
    desc: "아이템을 1개 이상 획득했다",
    check: (o, ctx) => o.player.inventory.length > 0 || ctx.everLooted,
  },
  {
    id: "level-up",
    tier: "landmark",
    desc: "레벨 2 이상에 도달했다",
    check: (o) => o.player.level >= 2,
  },
  {
    id: "reach-boss",
    tier: "landmark",
    desc: "보스와 조우했다",
    check: (o, ctx) => ctx.everSawBoss,
  },
  {
    id: "break-window",
    tier: "landmark",
    desc: "보스의 약점 노출 타이밍을 관측했다",
    check: (o, ctx) => ctx.everBreakWindow,
  },
  {
    id: "break-success",
    tier: "landmark",
    desc: "브레이크로 보스를 무력화했다",
    check: (o, ctx) => ctx.everBroken,
  },
  {
    id: "boss-defeated",
    tier: "objective",
    desc: "보스를 처치했다",
    check: (o) => o.bossDefeated,
  },
  {
    id: "survived",
    tier: "objective",
    desc: "클리어 시점에 플레이어가 살아있다",
    check: (o) => o.bossDefeated && !o.player.dead,
  },
]

/** 관측 스냅샷을 누적해 체크포인트 판정에 필요한 이력을 유지한다. */
export function createTracker() {
  const ctx = {
    startPos: null,
    everKilled: false,
    everLooted: false,
    everSawBoss: false,
    everBreakWindow: false,
    everBroken: false,
    deaths: 0,
    maxLevel: 1,
    wasDead: false,
    /** 동료가 플레이어에게서 가장 멀어졌던 거리. 낙오·끼임을 잡는 지표다. */
    maxCompanionGap: null,
    companionDeaths: 0,
    consoleErrors: [],
  }
  let prevCompanionDead = new Map()
  let prevXp = 0
  let prevLevel = 1

  return {
    ctx,
    update(o) {
      if (!o.ready) return
      if (!ctx.startPos) ctx.startPos = { ...o.player.world }
      if (o.player.xp > prevXp || o.player.level > prevLevel) ctx.everKilled = true
      prevXp = o.player.xp
      prevLevel = o.player.level
      if (o.player.inventory.length > 0) ctx.everLooted = true
      if (o.enemies.some((e) => e.isBoss)) ctx.everSawBoss = true
      if (o.bossDefeated) ctx.everSawBoss = true
      if (o.enemies.some((e) => e.break?.exposed)) ctx.everBreakWindow = true
      if (o.enemies.some((e) => e.break?.broken)) ctx.everBroken = true
      if (o.player.dead && !ctx.wasDead) ctx.deaths++
      ctx.wasDead = o.player.dead
      // 동료가 살아 있는 동안에만 거리를 잰다 (사망 중에는 제자리에 남기 때문)
      for (const c of o.party ?? []) {
        if (!c.dead) {
          const gap = Math.hypot(c.world.x - o.player.world.x, c.world.z - o.player.world.z)
          ctx.maxCompanionGap = ctx.maxCompanionGap === null ? gap : Math.max(ctx.maxCompanionGap, gap)
        }
        if (c.dead && !prevCompanionDead.get(c.name)) ctx.companionDeaths++
        prevCompanionDead.set(c.name, c.dead)
      }
      ctx.maxLevel = Math.max(ctx.maxLevel, o.player.level)
      for (const e of o.consoleErrors) if (!ctx.consoleErrors.includes(e)) ctx.consoleErrors.push(e)
    },
    evaluate(o) {
      return CHECKPOINTS.map((cp) => ({
        id: cp.id,
        tier: cp.tier,
        desc: cp.desc,
        passed: (() => {
          try {
            return !!cp.check(o, ctx)
          } catch {
            return false
          }
        })(),
      }))
    },
  }
}

export function formatReport(results, ctx, elapsedSec) {
  const byTier = { micro: [], landmark: [], objective: [] }
  for (const r of results) byTier[r.tier].push(r)
  const lines = []
  for (const tier of ["micro", "landmark", "objective"]) {
    lines.push(`[${tier}]`)
    for (const r of byTier[tier]) {
      lines.push(`  ${r.passed ? "PASS" : "FAIL"}  ${r.id.padEnd(18)} ${r.desc}`)
    }
  }
  const passed = results.filter((r) => r.passed).length
  lines.push("")
  lines.push(`통과 ${passed}/${results.length}  ·  사망 ${ctx.deaths}회  ·  최고 레벨 ${ctx.maxLevel}  ·  소요 ${elapsedSec}초`)
  if (ctx.maxCompanionGap !== null) {
    lines.push(`동료 최대 이격 ${ctx.maxCompanionGap.toFixed(1)}  ·  동료 사망 ${ctx.companionDeaths}회`)
  }
  if (ctx.consoleErrors.length > 0) {
    lines.push(`콘솔 에러 ${ctx.consoleErrors.length}건:`)
    for (const e of ctx.consoleErrors.slice(0, 5)) lines.push(`  - ${e}`)
  }
  return lines.join("\n")
}
