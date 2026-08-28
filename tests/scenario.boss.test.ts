import { describe, expect, it } from "vitest"
import { createGame } from "../src/scenario/headless"
import { advance, attack, cast, distanceTo, livingEnemies, moveTo, nearestEnemy } from "../src/scenario/run"

/**
 * 보스전 — **한 보스를 여러 방법으로 잡는가**.
 *
 * 확인하려는 것은 "이겼는가" 가 아니라 **싸움이 여러 국면을 거치는가** 다.
 * 패턴이 하나뿐이면 다섯 개를 만들어도 하나짜리 보스이므로, 실제 전투에서
 * 서로 다른 패턴이 몇 종류나 나오는지를 센다.
 */

const SHOW = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.SCENARIO_LOG === "1"

describe("보스전", () => {
  it("한 판에서 여러 패턴이 나오고, 저체력에서 국면이 바뀐다", () => {
    const game = createGame({ zoneId: "mine", seed: 21 })
    // 보스방까지 간다. 도중 교전은 그대로 치른다.
    // **접근 단계에서는 보스를 치지 않는다.** 처음엔 가장 가까운 적을 무조건 쳤더니
    // 보스방에 들어서면서 그대로 잡아 버려서, 정작 보고 싶은 보스전을 한 번도 못 봤다.
    for (let i = 0; i < 200; i++) {
      const trash = livingEnemies(game)
        .filter((e) => !e.boss)
        .sort((a, b) => distanceTo(game, a) - distanceTo(game, b))[0]
      if (trash && distanceTo(game, trash) < 13) attack(game, trash)
      else {
        const p = game.player.transform!.position
        if (p.z <= 18) break // 보스 아레나 바로 앞 복도에서 멈춘다
        moveTo(game, { x: p.x, z: Math.max(17, p.z - 8) })
      }
      advance(game, 0.5)
      if (game.player.dead) break
    }

    const boss = livingEnemies(game).find((e) => e.boss)
    if (SHOW || !boss) {
      const p = game.player.transform!.position
      console.log(`접근 후: z=${p.z.toFixed(1)} hp=${Math.round(game.player.health!.current)} dead=${!!game.player.dead} 남은적=${livingEnemies(game).length} 보스=${boss ? "있음" : "없음"}`)
    }
    expect(boss, "보스방에 도달하지 못했다").toBeDefined()
    expect(game.player.dead).toBeFalsy()

    // 보스전. 관측만 하고 조작은 공격 의도뿐이다.
    const fightStart = game.res.time.now
    const phases = new Set<string>()
    const patterns = new Set<string>()
    let lowPhaseSeen = false
    let minionsSeen = 0
    for (let i = 0; i < 600; i++) {
      // 보스 패턴 관측 중 사망해도 실제 게임의 부활 루프를 한 번 거친다.
      // S2의 windup/recovery가 추가된 뒤에는 공격만 반복하는 봇이 첫 국면에서
      // 쓰러질 수 있으므로, 죽음을 곧바로 관측 종료로 취급하지 않는다.
      if (game.player.dead) {
        advance(game, 3.5)
        continue
      }
      const b = livingEnemies(game).find((e) => e.boss)
      if (!b) break
      // 사람처럼 싸운다. 스킬을 하나도 안 쓰는 봇으로 재면 보스전이 10초 만에 끝나
      // 패턴을 한 종류밖에 못 본다 — 실제로 그랬다.
      const pc = game.player.player!
      const p = game.player.transform!.position
      const phase = b.boss!.phase
      const dashReady = pc.cooldowns.dash <= game.res.time.now
      // S2에서 스킬이 windup/recovery를 갖게 되면서, 이 시나리오도 실제 플레이처럼
      // 보스 예고를 보고 돌진으로 빠지는 입력을 포함한다. 공격 입력만 반복하면
      // 시전 후딜 동안 장판을 그대로 맞아 패턴 관측 전에 죽는다.
      if (!game.player.action && dashReady && (phase === "slamTelegraph" || phase === "chargeTelegraph" || phase === "sweepTelegraph")) {
        const dx = p.x - b.transform!.position.x
        const dz = p.z - b.transform!.position.z
        const len = Math.hypot(dx, dz) || 1
        const side = phase === "chargeTelegraph" ? { x: -dz / len, z: dx / len } : { x: dx / len, z: dz / len }
        cast(game, "dash", { x: p.x + side.x * 6, z: p.z + side.z * 6 })
      } else if (pc.rage >= 25 && distanceTo(game, b) < 3.5) cast(game, "whirlwind", { x: p.x, z: p.z })
      else attack(game, b)
      advance(game, 0.25)
      phases.add(b.boss!.phase)
      if (b.boss!.lastPatternId) patterns.add(b.boss!.lastPatternId)
      const frac = b.health!.current / b.health!.max
      if (frac < 0.45 && b.boss!.phase.startsWith("quake")) lowPhaseSeen = true
      // **보스가 부른 하수인만** 센다. 갱도에는 원래 돌격병이 있어서 종류로 세면 섞인다.
      const minions = (b.boss!.minions ?? []).filter((m) => !m.dead).length
      if (minions > minionsSeen) minionsSeen = minions
    }

    if (SHOW) {
      console.log(`\n패턴 ${[...patterns].join(", ")}`)
      console.log(`페이즈 ${[...phases].join(", ")}`)
      console.log(`동시 하수인 최대 ${minionsSeen} · 저체력 균열 ${lowPhaseSeen ? "관측" : "미관측"}`)
      console.log(`플레이어 ${game.player.dead ? "사망" : "생존"} · 보스 ${livingEnemies(game).some((e) => e.boss) ? "생존" : "처치"}`)
      console.log(`보스전 ${(game.res.time.now - fightStart).toFixed(1)}초`)
    }

    // 한 판에서 최소 세 종류의 패턴이 나와야 "여러 방법" 이 성립한다
    expect(patterns.size, `패턴이 ${patterns.size}종만 나왔다: ${[...patterns]}`).toBeGreaterThanOrEqual(3)
  }, 10000)
})
