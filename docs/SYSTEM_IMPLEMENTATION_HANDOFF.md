# 시스템 구현 상세 인계 계획

작성: Codex  
기준일: 2026-08-28  
검토/우선순위 승인: Claude Code(프로젝트 리드)  
일정·범위 승인: PM  
실행: 별도 시스템 작업자  
상태: **구현 전 인계 명세 — 이 문서는 소스 구현이 아니다**

> 현재 확정 분담은 **Claude = 시각·에셋 / Codex 계열 작업자 = 시스템**이다.
> `docs/VERTICAL_SLICE_RESTART_WBS.md`의 반대 역할 표기는 이전 제안이므로 이 문서와
> `docs/PLAN.md`의 최신 분담을 우선한다.

---

## 0. 이 문서의 사용법

이 문서는 다른 작업자가 별도 설계 판단 없이 시스템 작업을 수행할 수 있도록 작성한 실행 명세다.

작업자는 다음 규칙을 지킨다.

1. 한 번에 **작업 패키지 하나만** 연다.
2. 패키지 시작 전 `docs/BOARD.md`에 수정 예정 파일을 예약한다.
3. 시스템 판정과 의미 이벤트까지만 구현한다. 모델·색·VFX·사운드·HUD 배치는 구현하지 않는다.
4. 각 패키지의 단위 테스트와 타입체크를 순차 실행한다.
5. Claude가 이벤트를 시각 레이어에 연결하고 실제 브라우저에서 검증하기 전에는 플레이어-facing 완료로 표시하지 않는다.
6. 테스트 서버와 브라우저는 항상 하나만 실행한다. 테스트 명령도 병렬 실행하지 않는다.
7. 현재 저장소는 최초 커밋이 없으므로 `git reset --hard`, `git clean`, 강제 체크아웃 등 복구 불가능한 명령을 사용하지 않는다.

작업 상태는 다음 두 단계로 구분한다.

- **시스템 완료**: 판정·상태·이벤트·단위 검증이 끝남.
- **기능 완료**: Claude의 표현 연결과 실제 입력 녹화 검증까지 끝남.

시스템 완료를 기능 완료로 보고하지 않는다.

---

## 1. 현재 기준선

### 1.1 플레이 가능한 범위

- 이동: 클릭 이동, WASD 직접 이동
- 기본 공격: 120ms 준비동작, 근접 부채꼴 판정, 짧은 전진
- 스킬: 회전베기, 돌진
- 전투 피드백 기반: 히트스톱, 피격 경직, 넉백, 카메라 흔들림 훅
- 적 종류: `warrior`, `archer`, `charger`, `boss`
- `charger`는 타입·데이터·외형만 있으며 AI는 일반 근접 추격과 동일
- 정예: `enemy.isElite` 표식과 맵별 좌표는 있으나 실제 시스템 수식어가 충분하지 않음
- 보스: 다섯 패턴 데이터와 선택 조건은 있으나 `boss.ts`가 시뮬레이션·Three.js 텔레그래프·HUD·카메라를 함께 소유
- 진행: 레벨업, 드랍, 카탈로그 아이템, 장착, 마을·존 전환
- 헤드리스 시나리오: 실제 시스템 순서를 60Hz로 실행하고 결정적 로그를 생성

### 1.2 검증 기준선

Claude의 2026-08-28 보고 기준:

- TypeScript: 0 오류
- 단위 테스트: 357/357
- `playtest:town`: 16/16
- `playtest:zones`: 65/65
- 기본 시점 프레임 중앙값: 17.7ms

작업자는 시작 직후 숫자를 다시 실행해 맞추지 않는다. 먼저 PM 스냅샷과 파일 예약을 확인한 후,
해당 패키지의 표적 테스트만 실행한다. 전체 회귀는 패키지 종료 시 한 번 실행한다.

### 1.3 저장소 위험

- Git 저장소는 있으나 커밋이 0개이고 전체가 untracked다.
- 대규모 변경 전 PM의 최초 스냅샷 커밋이 최우선 안전장치다.
- PM이 스냅샷을 미루더라도 작업자는 기존 파일 삭제·이름 변경·대규모 이동을 하지 않는다.
- 패키지별 변경 파일 목록을 보드에 정확히 기록한다.

---

## 2. 플레이어-facing 계약

### 2.1 한 문장 약속

> 플레이어는 등불지기와 함께 무너진 갱도를 돌파하며, 적의 위협을 회피하거나 브레이크로 끊고,
> 서로 다른 용도의 스킬과 장비를 선택해 정예와 보스를 쓰러뜨린 뒤 보상을 들고 마을로 돌아온다.

### 2.2 핵심 반복

```text
이동·기본 공격으로 위치와 분노를 만든다
→ 회전베기·돌진·방어·처형 중 상황에 맞는 행동을 선택한다
→ 적의 역할과 예고를 읽고 교전을 통제한다
→ 처치·장비·레벨업으로 플레이 방식이 달라진다
→ 정예와 보스에서 배운 선택을 조합한다
→ 보상 후 마을 귀환으로 한 판을 닫는다.
```

### 2.3 시스템 품질 기준

- 입력 후 100ms 안에 자세·이동·예고 중 하나의 첫 반응이 시작된다.
- 모든 게임플레이 난수는 `Resources.rng`를 사용한다.
- 같은 시드와 같은 입력은 같은 피해·치명타·패턴·드랍 결과를 낸다.
- 시뮬레이션 코드는 `document`, `window`, Three.js 메시 생성에 의존하지 않는다.
- VFX·사운드·카메라는 상태를 역추론하지 않고 의미 이벤트를 소비한다.
- 기본 공격, 스킬, 정예 행동, 보스 패턴은 `windup → release/active → recovery`의 시간을 가진다.
- 브레이크 피해는 체력 피해와 별도 축이며 치명타 배수의 영향을 받지 않는다.
- 시스템 변경은 헤드리스 시나리오에서 먼저 증명하고 브라우저 표현 검증으로 닫는다.

---

## 3. 역할과 파일 경계

### 3.1 시스템 작업자 소유

- `src/core/world.ts`
- 새 시스템 계약 파일: `src/core/events.ts` 또는 프로젝트 리드가 승인한 동등 위치
- `src/systems/combat.ts`
- `src/systems/combatEvents.ts`
- `src/systems/skills.ts`
- `src/systems/ai.ts`
- `src/systems/boss.ts`
- `src/systems/loot.ts`
- `src/systems/progression.ts`
- `src/systems/movement.ts`의 판정 관련 부분
- `src/scenario/`의 시뮬레이션·로그 계약
- 시스템 단위 테스트와 시나리오 테스트

### 3.2 Claude 소유

- `src/systems/render.ts`
- `src/systems/combatVfx.ts`
- `src/systems/audio.ts`
- `src/systems/feedback.ts`의 표현 매핑
- `src/systems/enemyVisuals.ts`
- `src/systems/dungeonProps.ts`
- `src/systems/dungeonDressing.ts`
- `src/ui/*`
- `src/style.css`
- 모델·재질·텍스처·VFX·사운드·HUD·시각 QA

### 3.3 공유 파일

- `src/main.ts`: 시스템 등록 순서나 리소스 추가만. 시작 전 예약 필수.
- `src/content/items.ts`: 접사 규칙은 시스템 작업자, 이름·카탈로그 데이터는 Claude.
- `src/content/skills.ts`: 런타임 수치는 리드 승인 후 시스템 작업자, 설명·표현 메타데이터는 Claude.
- `src/content/enemies.ts`: 행동 파라미터는 시스템 작업자, 외형 키는 Claude.
- `src/content/patterns.ts`: 선택 계약은 공동 합의, 보스별 데이터는 Claude.
- `src/systems/input.ts`: 입력 의도까지만 시스템 작업자. UI DOM 조작은 추가하지 않는다.

### 3.4 금지되는 결합

- `combat.ts`에서 `spawnVfx`, `playSound`, CSS 클래스, 모델 경로를 호출하지 않는다.
- `feedback.ts`에서 체력·쿨다운·치명타 확률을 다시 계산하지 않는다.
- `boss.ts`에서 새 Three.js 지오메트리·머티리얼을 만들지 않는다.
- `ui/*`에서 `canCast`, 피해 배수, 장착 가능 여부를 복제하지 않는다.
- 시스템 핫패스에서 `Math.random`, `Date.now`, `performance.now`, `setTimeout`, 독립 `requestAnimationFrame`을 사용하지 않는다.

---

## 4. 실행 순서 결정

### 4.1 기본 순서 — Claude 리드 요청 준수

1. S0 안전 기준선과 이벤트 기반 준비
2. S1 접사 축 확장
3. S2 `SkillCastEvent` 계약
4. S3 `guard`·`execution` 시전 경로
5. S4 부술 수 있는 소품
6. S5 `charger` 전용 AI와 정예 작동
7. S6 보스 시스템 소유권 정리
8. S7 세로 슬라이스 진행 상태와 보상·귀환 폐쇄
9. S8 밸런스·회귀·인계

### 4.2 속도 우선 대체 순서 — 리드 승인 시에만

화면에서 완성도가 빨리 드러나는 임계 경로는 아래다.

1. S0
2. S2 이벤트 계약
3. S5 돌진형 AI
4. S6 보스 시스템
5. S7 완주 흐름
6. S1 접사
7. S3 신규 스킬
8. S4 소품
9. S8

이 순서는 액션 세로 슬라이스를 빨리 보이게 하지만 Claude의 최신 우선순위와 다르다.
작업자는 임의로 선택하지 않는다. 별도 승인이 없으면 4.1을 따른다.

### 4.3 동시 작업 제한

- 시스템 작업자 WIP: 패키지 1개
- Claude 표현 WIP: 직전 시스템 패키지의 시각 연결 1개
- 시스템 작업자는 Claude가 직전 이벤트를 연결하는 동안 다음 패키지의 **읽기·테스트 설계**만 할 수 있다.
- 같은 파일을 양쪽이 동시에 수정하지 않는다.

---

## 5. 공통 이벤트 아키텍처

현재 `combatEvents.ts`는 ECS 상태 델타를 관찰한다. 이 방식은 기존 피해·사망에는 작동하지만
준비동작 시작, 시전 취소, 치명타 원인, 보스 패턴 선택 같은 의미를 정확히 알 수 없다.

### 5.1 목표

시뮬레이션 시스템이 명시적 의미 이벤트를 발행하고, 기존 `CombatEvent`는 점진적 호환 어댑터로 유지한다.

권장 새 파일:

```text
src/core/events.ts
```

권장 계약:

```ts
export interface EventEnvelope<TType extends string, TPayload> {
  sequence: number
  type: TType
  simulationTime: number
  payload: TPayload
}

export type GameplayEvent =
  | EventEnvelope<"damageResolved", DamageResolvedPayload>
  | EventEnvelope<"skillCast", SkillCastPayload>
  | EventEnvelope<"enemyAction", EnemyActionPayload>
  | EventEnvelope<"bossPattern", BossPatternPayload>
  | EventEnvelope<"propBreak", PropBreakPayload>

export interface GameplayEventBuffer {
  nextSequence: number
  pending: GameplayEvent[]
}
```

`Resources`에 `events: GameplayEventBuffer`를 추가한다. `main.ts`와 `scenario/headless.ts`가 각각 독립 버퍼를 생성한다.

### 5.2 이벤트 규칙

- `sequence`는 해당 게임 세션에서 단조 증가한다.
- `simulationTime`은 `res.time.now`다.
- 이벤트 위치는 `position`으로 부른다. 기존 `CombatEvent.at`과 시간의 의미를 섞지 않는다.
- 이벤트 발행 시 payload를 복사한다. 이후 엔티티 변형 때문에 과거 로그가 바뀌지 않아야 한다.
- 엔티티 참조는 런타임 편의용으로 허용하지만 로그에는 안정적인 `entityRole`, `enemyKind`, `skillId`도 포함한다.
- 버퍼는 프레임당 한 번 drain한다. 브라우저는 `feedbackSystem`, 헤드리스는 시나리오 러너가 소비한다.
- 상태 델타 관찰은 마이그레이션되지 않은 기존 이벤트에만 유지한다.
- 같은 의미를 명시 이벤트와 상태 델타로 두 번 내보내지 않는다.

### 5.3 업데이트 순서

현재 순서를 유지하되 이벤트 수집 위치를 명확히 한다.

```text
input
→ directMove
→ ai
→ party
→ break
→ boss
→ skills
→ movement
→ combat
→ loot
→ progression
→ animation state
→ town/zone
→ explicit event drain + legacy observer adapter
→ audio/VFX/camera/HUD feedback
→ render
```

히트스톱 중에도 이벤트·카메라·VFX 시간은 실제 시간으로 진행할 수 있어야 한다.
게임플레이 판정은 `res.time.now`, 표현 감쇠는 `res.time.realNow`를 사용한다.

---

## S0 — 안전 기준선과 작업 예약

### 목표

작업자가 변경을 시작하기 전에 복구 가능성과 파일 소유권을 명확히 한다.

### 작업

- [ ] PM의 최초 스냅샷 커밋 여부 확인
- [ ] `docs/BOARD.md`에 현재 패키지명, 담당자, 수정 예정 파일 기록
- [ ] `git status --short` 결과 기록
- [ ] 패키지의 표적 테스트 목록 확정
- [ ] Claude가 같은 파일을 수정 중이지 않은지 확인
- [ ] 현재 기준선 테스트 수와 타입체크 상태를 보드의 실행 시각과 함께 기록

### 완료 조건

- 수정 파일 소유자가 한 명이다.
- 실패 시 되돌릴 파일 목록이 명확하다.
- 브라우저·서버 프로세스를 띄우지 않은 상태로 시작한다.

---

## S1 — 접사 축 확장

### 1. 목표

아이템 이름과 외형뿐 아니라 실제 플레이 선택이 달라지도록 접사를 3축에서 9축으로 확장한다.

### 2. 데이터 계약

`Affix["stat"]`를 별도 타입으로 추출한다.

```ts
export type AffixStat =
  | "attackPower"
  | "maxHp"
  | "moveSpeedPct"
  | "critChance"
  | "critDamage"
  | "attackSpeedPct"
  | "breakPower"
  | "cooldownReductionPct"
  | "lifeOnKill"
```

`PlayerComp`에 다음 파생값을 명시적으로 둔다.

```ts
critChance: number              // 퍼센트 포인트, 기본 0
critDamage: number              // 총 피해 배수 %, 기본 150
attackSpeedPct: number          // 기본 공격 속도 증가 %, 기본 0
breakPower: number              // 모든 플레이어 공격의 고정 브레이크 보너스, 기본 0
cooldownReductionPct: number    // 스킬 쿨다운 감소 %, 기본 0
lifeOnKill: number              // 처치당 고정 추가 회복량, 기본 0
```

권장 안전 상한:

| 축 | 최소 | 상한 | 비고 |
|---|---:|---:|---|
| 치명타 확률 | 0 | 60 | 100% 고정화를 막음 |
| 치명타 피해 | 100 | 300 | 기본 150 |
| 공격 속도 | 0 | 50 | 기본 공격 애니메이션/판정 붕괴 방지 |
| 쿨다운 감소 | 0 | 40 | 무한 스킬 순환 방지 |
| 브레이크 위력 | 0 | 60 | 체력 피해와 별도 |
| 처치 회복 | 0 | 30 | 기존 3% 회복 위에 더함 |

초기 절차적 접사 범위:

| 접사 | 한 줄의 범위 |
|---|---:|
| `attackPower` | 2~6 |
| `maxHp` | 5~20 |
| `moveSpeedPct` | 5~10 |
| `critChance` | 3~7%p |
| `critDamage` | 10~25%p |
| `attackSpeedPct` | 4~10% |
| `breakPower` | 3~8 |
| `cooldownReductionPct` | 3~7%p |
| `lifeOnKill` | 1~4 |

이 값은 첫 구현의 안전 범위다. 드랍률·카탈로그 기본값은 이 패키지에서 재밸런싱하지 않는다.

### 3. 파생 스탯 계산

`computeDerived` 반환 타입을 `DerivedPlayerStats`로 명명한다.

규칙:

- `attackPower`, `maxHp`, 신규 고정 수치는 합연산
- `moveSpeedPct`는 기존 호환을 위해 장비별 곱연산 유지
- `attackSpeedPct`, `cooldownReductionPct`는 합산 후 상한 적용
- `critDamage`는 기본 150에 접사를 더함
- 장착을 해제하면 모든 파생값이 기본값으로 정확히 돌아옴
- `recalcStats`는 기존 체력 비율 보존 규칙을 유지
- 레벨업과 장착 모두 동일한 `recalcStats` 경로 사용

### 4. 실제 효과 연결

#### 치명타

- 플레이어가 가한 기본 공격·회전베기·돌진·향후 처형만 치명타 가능
- 동료·적·환경 피해는 이번 패키지에서 치명타를 굴리지 않음
- `res.rng() < critChance / 100`으로 판정
- 체력 피해에만 `critDamage / 100` 적용
- 브레이크 피해에는 치명타 배수를 적용하지 않음
- 집중 피해와 치명타가 함께 발생하면 둘 다 곱함
- 계산 순서: 기본 피해 → 스킬 계수 → 치명타 → 집중 피해 → 체력 차감
- 표시용 반올림과 실제 체력 계산을 분리하지 말고 현재 실수 피해 호환을 유지

권장 순수 함수:

```ts
resolveOutgoingDamage(
  baseAmount: number,
  source: Entity,
  target: Entity,
  rng: () => number,
  focused: boolean,
): { amount: number; critical: boolean; focused: boolean }
```

`dealDamage`는 이 결과를 한 번만 사용한다. VFX와 로그가 피해를 재계산하지 않는다.

#### 공격 속도

- 기본 공격 쿨다운에만 적용
- 유효 쿨다운: `baseCooldown / (1 + attackSpeedPct / 100)`
- `attack.cooldown` 원본을 매 장착 때 덮어쓰지 않는다. 반복 재계산으로 값이 누적되는 것을 막는다.
- `queueMeleeAttack`이 플레이어의 공격 속도를 인자로 받아 `readyAt`을 계산한다.
- 준비동작은 첫 구현에서 120ms 고정. 공격 속도가 준비동작보다 짧은 쿨다운을 만들면 상한 50%가 방지한다.

#### 쿨다운 감소

- 회전베기·돌진·향후 방어·처형에 적용
- 유효 쿨다운: `baseCooldown * (1 - cappedCdr / 100)`
- HUD는 기본 쿨다운이 아니라 실제 유효 쿨다운으로 남은 비율을 계산하도록 Claude에 값만 제공
- 쿨다운 종료 시각을 장비 교체로 소급 변경하지 않는다. 다음 시전부터 적용

#### 브레이크 위력

- `실제 브레이크 피해 = 스킬/기본 공격 고유 breakPower + player.breakPower`
- 치명타 여부와 무관
- 노출 창 밖에서는 기존 규칙대로 게이지가 줄지 않음

#### 처치 회복

- 기존 회복: 최대 체력의 3%
- 추가 회복: `player.lifeOnKill * kills`
- 최종: `round(maxHp * 0.03) * kills + player.lifeOnKill * kills`
- 오버힐 금지
- 동료의 처치가 현재 플레이어 XP로 집계되는 기존 규칙을 유지한다면 추가 회복도 동일하게 적용

### 5. 치명타 이벤트

S1에서 S5의 공통 이벤트 버퍼 최소 골격을 함께 만든다.

`damageResolved` payload 권장안:

```ts
interface DamageResolvedPayload {
  source: Entity
  target: Entity
  sourceRole: "player" | "companion" | "enemy" | "environment"
  amount: number
  critical: boolean
  focused: boolean
  killed: boolean
  position?: Vec3
}
```

`combatEvents.ts`는 이를 다음 표현 이벤트로 변환한다.

- 플레이어 피격: `playerHurt`
- 치명타: `crit`
- 집중 피해: `hitHeavy`
- 일반 타격: `hit`

우선순위는 `playerHurt > crit > hitHeavy > hit`이다. `crit` payload에는 `focused`를 남겨
Claude가 치명타+집중 피해를 더 강하게 표현할 수 있게 한다.

### 6. 수정 예정 파일

- `src/core/world.ts`
- `src/core/events.ts` 신규
- `src/content/items.ts`
- `src/systems/loot.ts`
- `src/systems/combat.ts`
- `src/systems/combatEvents.ts`
- `src/systems/skills.ts`
- `src/systems/progression.ts`
- `src/main.ts` 리소스 초기화 한정
- `src/scenario/headless.ts` 리소스 초기화 한정
- 소비자 타입 오류가 날 경우 `src/scenario/text.ts`에 `crit` 문구만 최소 추가
- 테스트 파일

`ui/hud.ts`, `ui/panels.ts`, `style.css`는 수정하지 않는다. 새 라벨과 표시 방식은 Claude 인계 항목이다.

### 7. 단위 테스트

- [ ] 각 신규 접사가 중복 없이 굴려질 수 있음
- [ ] 같은 시드로 같은 접사 결과
- [ ] 모든 접사의 최소/최대 범위
- [ ] 파생값 기본값
- [ ] 여러 장비의 합산과 상한
- [ ] 장비 해제 후 원복
- [ ] 체력 비율 보존
- [ ] 치명타 RNG 경계: 바로 아래 성공, 바로 위 실패
- [ ] 치명타와 집중 피해의 결합
- [ ] 치명타가 브레이크 피해를 늘리지 않음
- [ ] 공격 속도 쿨다운 공식
- [ ] CDR 공식과 40% 상한
- [ ] 처치 회복과 오버힐 제한
- [ ] `damageResolved`가 한 피해당 한 번만 발생
- [ ] `crit`와 일반 `hit`가 중복 발생하지 않음

### 8. 표적 검증 순서

```text
npm run test -- tests/items.test.ts
npm run test -- tests/combat.test.ts
npm run test -- tests/skills.test.ts
npm run test -- tests/progression.test.ts
npm run test -- tests/combatEvents.test.ts
npm run typecheck
npm run test
```

각 명령이 끝난 후 다음 명령을 실행한다.

### 9. 시스템 완료 조건

- 신규 6축이 실제 판정에 영향을 준다.
- 치명타가 결정적 RNG로 재현된다.
- `crit` 이벤트가 정확히 한 번 발생한다.
- 기존 장비·드랍·레벨업 테스트가 약화 없이 통과한다.
- Claude가 필요로 하는 payload 예시가 보드에 기록돼 있다.

### 10. Claude 인계

- 상태창 접사 라벨과 실제 파생값 표시
- 치명타 숫자 크기·색·전용 스파크
- 치명타 카메라 진폭과 히트스톱 튜닝
- 접사별 아이콘 또는 툴팁 문법
- 브라우저에서 같은 시드로 치명타 장면 녹화

---

## S2 — `SkillCastEvent` 계약

### 1. 목표

분노 감소·쿨다운 증가를 관찰해 시전을 추정하지 않고, 스킬 상태 머신이 준비와 발동을 명시적으로 알린다.

### 2. 계약

```ts
export type SkillId = "whirlwind" | "dash" | "guard" | "execution"
export type SkillCastPhase = "windup" | "release"

export interface SkillCastPayload {
  castId: number
  skillId: SkillId
  phase: SkillCastPhase
  caster: Entity
  position: Vec3
  yaw: number
  targetPoint?: Vec2
}
```

- `castId`는 시전 시작 때 생성하고 release까지 유지
- `simulationTime`은 이벤트 envelope에 포함
- `position`, `yaw`, `targetPoint`는 발행 시점 값의 복사본
- 입력이 거절되면 이벤트 없음
- windup 후 피격으로 취소되는 스킬이 생기면 후속 계약에서 `cancel`을 추가하고, 이번 배치에 임의로 넣지 않음

### 3. 행동 상태

플레이어 엔티티에 범용 상태를 둔다.

```ts
interface ActionState {
  kind: "skill"
  skillId: SkillId
  castId: number
  phase: "windup" | "recovery"
  phaseUntil: number
  targetPoint?: Vec2
}
```

첫 마이그레이션:

- 회전베기: windup 140ms → release 판정 → recovery 260ms
- 돌진: windup 90ms → release 시 이동/경로 판정 → recovery 180ms

이 값은 시스템 초기값이며 Claude 녹화 검증 후 한 축씩 조정한다.

### 4. 입력 버퍼

- 입력 수집은 `skillIntent`를 만든다.
- 실행 가능하면 `ActionState`로 승격하고 windup 이벤트를 발행한다.
- 짧은 recovery 동안 들어온 입력 하나를 최대 180ms 저장할 수 있다.
- 죽음·존 전환·경직 시 버퍼를 지운다.
- 같은 프레임 다중 시전을 금지한다.
- 분노와 쿨다운은 release가 아니라 **시전 수락 시점**에 소비해 중복 입력을 막는다.
- 시전이 시스템적으로 취소되는 계약을 나중에 도입할 경우 환불 규칙을 별도 명시한다.

### 5. 기존 관찰 로직 제거

- `dash cooldown 증가 = dash 이벤트`
- `rage 감소 = whirlwind 이벤트`

위 두 추론은 명시 이벤트가 연결된 뒤 제거한다.
호환 기간에 둘을 동시에 유지해 중복 VFX를 만들지 않는다.

### 6. 테스트

- [ ] 시전 불가 시 이벤트 0개
- [ ] 시전 수락 시 windup 1개
- [ ] 정해진 시간 전 release 없음
- [ ] 정해진 시간에 release 1개
- [ ] windup과 release의 castId 동일
- [ ] 이벤트 위치·방향이 발행 시점 값으로 고정
- [ ] 한 입력으로 판정 1회
- [ ] recovery 중 중복 시전 금지
- [ ] 입력 버퍼 만료
- [ ] 죽음·존 전환 시 action/buffer 정리
- [ ] 헤드리스와 브라우저 런타임의 시스템 순서 동일

### 7. 시스템 완료 조건

- 회전베기와 돌진이 상태 변화 추론 없이 정확한 windup/release를 낸다.
- 기존 VFX가 중복되지 않는다.
- 시나리오 로그에 시전 시작과 발동 시점이 구분돼 찍힌다.

### 8. Claude 인계

- windup: 포즈·예고·시작 사운드
- release: 고유 VFX·타격 사운드·카메라·HUD 반응
- castId로 다단 VFX 묶음 관리
- 행동별 24프레임 스트립으로 준비동작 확인

---

## S3 — `guard`와 `execution` 시전 경로

### 1. 선행 조건

- S2 완료
- Claude가 아래 초기 수치를 승인하거나 대체 수치를 `content/skills.ts`에 확정
- UI가 없어도 실제 키 입력과 헤드리스 intent로 시전 가능해야 함

### 2. 공통 타입 확장

- `SkillId`와 `skillIntent.skill`에 `guard`, `execution` 추가
- `PlayerComp.cooldowns`를 하드코딩 객체 대신 `Partial<Record<SkillId, number>>` 또는 전체 Record로 전환
- `Hud.setSkillCooldown`은 시스템에서 직접 확장하지 않고 Claude가 소비할 snapshot을 제공
- 키 제안: `Digit3 = guard`, `Digit4 = execution`
- 기존 우클릭 회전베기·Space 돌진 유지

### 3. 방어 초기 계약

권장 초기값:

| 항목 | 값 |
|---|---:|
| 해금 | Lv.2 |
| 분노 | 20 |
| 쿨다운 | 6초 |
| windup | 120ms |
| 지속 | 1.25초 |
| 피해 감소 | 50% |
| recovery | 180ms |

컴포넌트:

```ts
guarding?: {
  until: number
  damageMultiplier: number
}
```

규칙:

- 플레이어가 받는 체력 피해에만 적용
- 넉백·브레이크·경직 면역을 주지 않음
- 중복 시전은 지속시간을 누적하지 않음
- 방어 중 이동 가능
- 다른 스킬 시전은 불가
- 존 전환·사망 시 제거
- 피해 숫자 이벤트에는 감소 후 실제 피해량 기록

### 4. 처형 초기 계약

권장 초기값:

| 항목 | 값 |
|---|---:|
| 해금 | Lv.3 |
| 분노 | 35 |
| 쿨다운 | 6초 |
| 사거리 | 2.0 |
| windup | 280ms |
| recovery | 350ms |
| 대상 조건 | 현재 HP 35% 이하 |
| 피해 | 35 + 공격력 1.2배 |

규칙:

- 가장 가까운 유효 적 하나를 대상으로 함
- 보스도 사용 가능하지만 즉사 판정은 없음
- 대상 조건이 맞지 않으면 자원·쿨다운 소비 없음
- release 직전 대상이 죽거나 사거리를 벗어나면 실패하고 판정 없음; 첫 구현에서는 자원 환불 없음
- 치명타 가능
- 브레이크 피해 기본값은 18, 장비 `breakPower` 보너스 적용
- 처치 시 기존 XP·드랍·처치 회복 경로를 그대로 사용

### 5. 테스트

- [ ] 레벨 잠금
- [ ] 분노·쿨다운 검사
- [ ] 방어의 실제 피해 감소
- [ ] 방어가 경직·넉백을 지우지 않음
- [ ] 방어 종료와 존 전환 정리
- [ ] 처형 HP 임계값 경계
- [ ] 처형 사거리 경계
- [ ] 자원 선소비 중복 방지
- [ ] 처형 치명타와 브레이크 분리
- [ ] 보스 대상 즉사 없음
- [ ] windup/release 이벤트 payload

### 6. 기능 완료 조건

시스템 완료 후 Claude가 다음을 붙여야 기능 완료다.

- 방어 자세·방패 VFX·피해 흡수음·HUD 지속시간
- 처형 전용 자세·도약/전진·타격 VFX·처치 강화 연출
- 스킬창·단축키 슬롯·쿨다운 표시
- 실제 입력 영상에서 네 스킬이 화면과 소리만으로 구분

---

## S4 — 부술 수 있는 소품

### 1. 목표

장식 소품을 전투 반응 대상으로 만들어 공격이 환경에 닿는 느낌과 선택적 보상을 만든다.

### 2. 시스템 계약

```ts
interface DestructibleComp {
  kind: string
  currentHp: number
  maxHp: number
  radius: number
  state: "intact" | "broken"
  blocksMovement: boolean
  dropTableId?: string
}
```

`Entity`에 `destructible?: DestructibleComp`를 추가한다.

### 3. 피해 규칙

- 플레이어 기본 공격과 공격 스킬만 소품에 피해를 줌
- 적·동료 공격은 첫 버전에서 소품을 무시
- 소품은 치명타를 받지 않음
- 브레이크 게이지 없음
- 기본 공격은 타겟이 소품일 때 동일한 부채꼴 판정 사용
- 회전베기는 반경 안 소품을 함께 판정
- 돌진은 경로 안 소품을 판정하고, 부서지면 이동을 막지 않음
- 내구도 0에서 `propBreak` 이벤트 1회
- XP 없음
- 드랍은 `dropTableId`가 있을 때 기존 seeded RNG 경로 사용

### 4. 이동 충돌

- `blocksMovement=true` 소품은 별도 단순 원형 충돌 프록시를 사용
- 파괴 후 즉시 충돌 목록에서 제외
- 시각 메시의 복잡한 형태를 충돌로 쓰지 않음
- 경로 탐색 그리드까지 동적으로 다시 만드는 것은 첫 버전 범위 밖. 좁은 핵심 통로를 막는 배치는 금지

### 5. 이벤트

```ts
interface PropBreakPayload {
  prop: Entity
  propKind: string
  source: Entity
  position: Vec3
  impulse: Vec2
  droppedItemIds: number[]
}
```

### 6. 테스트

- [ ] 플레이어 공격으로 내구도 감소
- [ ] 적·동료 공격 무시
- [ ] 광역/직선 판정
- [ ] 0에서 한 번만 파괴
- [ ] 파괴 후 충돌 해제
- [ ] 같은 시드의 드랍 재현
- [ ] 존 전환 시 transient 소품 상태 정리
- [ ] `propBreak` 이벤트 1회

### 7. Claude 인계

- 배치와 소품 종류
- 온전/피격/파괴 지오메트리
- 파편 풀링, 먼지, 음향, 드랍 강조
- `destructible` 반경과 실제 메시 스케일 일치 여부 시각 QA

---

## S5 — `charger` 전용 AI와 정예 작동

### 1. 현재 상태 정정

`EnemyKind = "charger"`와 스폰 데이터는 이미 존재한다. 새 타입을 추가하지 않는다.
현재 부족한 것은 **전용 행동 상태**다.

### 2. 컴포넌트

```ts
interface ChargeBehaviorComp {
  phase: "pursuit" | "windup" | "active" | "recovery"
  phaseUntil: number
  cooldownUntil: number
  direction: Vec2
  start: Vec2
  distanceRemaining: number
  hitTarget: boolean
}
```

### 3. 초기 튜닝

| 항목 | 값 |
|---|---:|
| 준비 시작 거리 | 4~9 |
| windup | 650ms |
| 돌진 속도 | 16 |
| 최대 거리 | 6 |
| 경로 반폭 | 0.65 |
| 피해 | 12 |
| 플레이어 넉백 | 속도 8 / 180ms |
| 종료 경직 | 900ms |
| 재사용 대기 | 3.5초 |

### 4. 상태 전이

```text
pursuit
  ├─ 거리 4~9 + 시야 확보 + cooldown 완료 → windup
  └─ 그 외 → 기존 chase/return

windup
  ├─ 650ms 동안 정지, 방향 잠금, enemyAction(windup)
  ├─ 피격 경직/브레이크/대상 소실 → recovery
  └─ 만료 → active + enemyAction(release)

active
  ├─ 고정 방향으로 swept 이동
  ├─ 플레이어/동료를 최대 1회 타격
  ├─ 벽 충돌 또는 거리 소진 → recovery
  └─ 타격 후에도 남은 거리를 이동하되 중복 피해 없음

recovery
  └─ 900ms 후 pursuit, cooldown은 유지
```

### 5. 정예 수식어

정예는 종류가 아니라 직교 수식어로 유지한다.

초기 시스템 수식어:

| 항목 | 일반 대비 |
|---|---:|
| HP | ×1.75 |
| 피해 | ×1.25 |
| 공격/행동 쿨다운 | ×0.9 |
| XP | ×2 |
| 브레이크 게이지 | 60 |

세로 슬라이스 정예는 `charger + isElite` 조합을 기본으로 한다.

- 돌진 windup 동안 브레이크 창을 연다.
- 브레이크 성공 시 돌진 취소, 3초 무력화, 기존 집중 피해 계약 사용.
- 동료만으로 브레이크가 자동 완료되지 않는지는 Claude 플레이 계측 항목으로 남긴다.

### 6. 이벤트

```ts
interface EnemyActionPayload {
  actionId: "charge"
  phase: "windup" | "release" | "impact" | "recovery"
  actor: Entity
  position: Vec3
  direction: Vec2
  target?: Entity
  elite: boolean
}
```

### 7. 테스트

- [ ] 거리·시야·쿨다운 조건
- [ ] windup 동안 이동 없음
- [ ] 방향이 windup 시작 후 고정
- [ ] 고속 이동이 벽을 통과하지 않음
- [ ] swept 경로 안/밖 판정
- [ ] 한 돌진당 대상 1회 피해
- [ ] 피격 경직과 브레이크 취소
- [ ] recovery 동안 공격 불가
- [ ] 리쉬 초과 시 귀환
- [ ] 정예 배율이 중복 적용되지 않음
- [ ] 정예 브레이크 창
- [ ] 동일 시드·입력의 이벤트 순서 재현

### 8. 기능 완료 조건

- 시스템: 일반 근접형과 다른 로그·타이밍·진로를 보임
- Claude: 준비 자세·직선 예고·돌진 잔상·벽 충돌·회복 자세 구현
- 실제 플레이: 설명 없이 “곧 직선으로 돌진한다”를 첫 조우에 예측 가능

---

## S6 — 보스 시스템 소유권 정리

### 1. 문제

현재 `systems/boss.ts`는 다음을 모두 한다.

- 패턴 선택과 상태 전이
- 피해·이동·브레이크 판정
- Three.js 텔레그래프 메시 생성
- 머티리얼 생성
- HUD 갱신
- 카메라 흔들림

이는 확정된 `Claude=시각 / 시스템 작업자=판정` 경계를 위반한다.

### 2. 목표 구조

```text
content/patterns.ts      보스별 패턴 데이터 (Claude)
systems/boss.ts          선택·상태·판정·이벤트 (시스템 작업자)
systems/bossVisuals.ts   텔레그래프·재질·카메라·표현 (Claude 신규)
ui/hud.ts                보스바·브레이크 표시 (Claude)
```

### 3. 시스템 상태

`BossComp`는 현재 페이즈 문자열 외에 패턴 런타임을 명시한다.

```ts
interface BossPatternRuntime {
  patternId: string
  phase: "telegraph" | "active" | "recovery"
  phaseUntil: number
  origin: Vec2
  targetPoint?: Vec2
  direction?: Vec2
  repeatIndex: number
}
```

기존 `slamTelegraph`, `slamming` 등의 렌더 지향 페이즈는 마이그레이션 후 제거하거나
호환 어댑터 한 곳에서만 사용한다.

### 4. 데이터 단일 진실

- `BOSS.slam.telegraph`, `BOSS.charge.*`와 `content/patterns.ts` 중복 제거
- telegraph, active, damage, range, width, repeatCount, repeatInterval은 `PatternDef`에서 읽음
- 돌진 active 시간은 `range / speed` 파생값 사용
- 보스 공통 패턴 간격만 시스템 상수로 유지 가능
- 패턴 조건·우선순위·가중치 선택은 기존 `selectPattern` 유지

### 5. 이벤트

```ts
interface BossPatternPayload {
  boss: Entity
  patternId: string
  phase: "telegraph" | "release" | "impact" | "end" | "cancel"
  position: Vec3
  targetPoint?: Vec2
  direction?: Vec2
  shape: PatternShape
  radius?: number
  range?: number
  width?: number
  opensBreakWindow: boolean
  repeatIndex: number
}
```

- 브레이크 성공 시 현재 패턴 `cancel` 발행
- 보스 사망·존 전환 시 `cancel` 또는 명시 정리 이벤트
- 시각 메시의 생성·제거는 Claude 소비자가 담당
- 보스 HUD는 읽기 전용 snapshot이나 이벤트를 통해 갱신

### 6. 상태 머신 규칙

- 조우 전 idle
- 패턴 선택 시 telegraph 이벤트
- telegraph 동안 브레이크 창이 열리는 패턴만 게이지 활성
- 만료 시 release/impact 판정
- active/repeat 완료 후 recovery
- recovery 후 cooldown을 거쳐 다음 선택
- 동일 패턴 연속 금지, 저체력 quake 우선, 하수인 2기 이상 소환 금지 유지
- 브레이크 성공 시 판정·이동·후속 반복을 모두 취소
- hitstun은 보스 패턴을 영구 정지시키지 않음

### 7. 테스트

- [ ] 다섯 패턴 조건과 가중치
- [ ] 데이터 값이 실제 판정에 사용됨
- [ ] telegraph → release → end 순서
- [ ] repeatIndex
- [ ] charge active 파생 시간
- [ ] 브레이크 cancel
- [ ] 소환물 수 조건
- [ ] 패턴 중 보스 사망 정리
- [ ] 존 전환 후 이전 이벤트/상태 없음
- [ ] 같은 시드로 같은 패턴 순서
- [ ] 시스템 파일에서 `three` import 없음
- [ ] 시스템 파일에서 `hud`, `shakeCamera`, 지오메트리 생성 호출 없음

### 8. 공동 마이그레이션 절차

1. 시스템 작업자가 이벤트와 순수 판정을 추가하되 기존 텔레그래프를 즉시 삭제하지 않는다.
2. Claude가 `bossVisuals.ts` 소비자를 붙인다.
3. 같은 시드의 기존/신규 패턴 순서와 판정 로그를 비교한다.
4. 브라우저에서 다섯 패턴의 텔레그래프와 정리 확인.
5. 그 뒤 `boss.ts`의 Three.js/HUD/카메라 코드를 제거한다.

중간 단계에서 텔레그래프가 사라진 채 병합하지 않는다.

---

## S7 — 세로 슬라이스 진행 상태와 보상·귀환 폐쇄

### 1. 목표

```text
마을 → 문지기 → 갱도 → 교전 3회 → 정예 → 보스 → 보상 → 마을 귀환
```

이 흐름을 실제 입력과 헤드리스 양쪽에서 끊김 없이 닫는다.

### 2. 진행 상태

```ts
type MineRunPhase =
  | "entered"
  | "encounters"
  | "eliteAvailable"
  | "bossAvailable"
  | "bossDefeated"
  | "rewardClaimed"
  | "returnAvailable"
```

별도 런타임 상태에 다음을 기록한다.

- 현재 phase
- 완료한 교전 ID 집합
- 정예 처치 여부
- 보스 처치 여부
- 보상 수령 여부
- 런 시작 시드
- 런 시작/완료 시각

### 3. 규칙

- 맵의 적 수만 세어 진행하지 않는다. 방 또는 조우 ID로 완료를 판정한다.
- 보스는 정예 전투 완료 전까지 비활성 또는 접근 차단 상태다.
- 보스 처치 후 보상은 한 번만 생성한다.
- 보상 수령 후 귀환 상호작용을 활성화한다.
- 마을 귀환 시 레벨·인벤토리·장비는 유지한다.
- 던전 transient 엔티티·이벤트·VFX 상태는 정리한다.
- 재입장 시 새 런으로 초기화하되, 영구 성장 상태는 보존한다.
- 사망/부활 정책은 기존 입구 부활을 유지하고 이번 패키지에서 데스페널티를 추가하지 않는다.

### 4. 보상

- 보스 기존 드랍을 유지
- 세로 슬라이스 완료 보상은 카탈로그 6종 중 하나를 seeded RNG로 선택
- 같은 런에서 중복 생성 금지
- 인벤토리 가득 참 처리: 바닥에 유지하고 귀환 가능 상태는 보상 획득 전까지 잠금 또는 보상 보관 슬롯 사용. 리드가 하나를 선택해야 함

권장안: 보상은 바닥에 유지하며 인벤토리 한 칸을 비우기 전 귀환 상호작용에 경고를 표시한다.

### 5. 테스트

- [ ] 순서를 건너뛰어 보스 활성 불가
- [ ] 교전 3회 완료 판정
- [ ] 정예 처치 후 보스 활성
- [ ] 보스 보상 한 번
- [ ] 보상 후 귀환
- [ ] 성장 상태 유지
- [ ] transient 상태 정리
- [ ] 재입장 새 런
- [ ] 같은 시드 보상 재현
- [ ] 실제 시나리오 완주 300초 내 종료

### 6. 기능 완료 조건

- 헤드리스 시나리오가 구조적으로 완주
- Claude의 실제 입력 하니스가 문지기부터 귀환까지 완주
- 완료 영상에 교전·정예·보스·보상·귀환이 모두 포함

---

## S8 — 밸런스, 회귀, 최종 인계

### 1. 밸런스 관측

최소 시드 3개를 순차 실행한다.

기록할 값:

- 총 완주 시간
- 첫 교전까지 시간
- 교전별 소요 시간
- 받은 피해와 피격 횟수
- 스킬별 시전 횟수
- 스킬별 피해 기여
- 치명타 횟수·비율
- 브레이크 시도·성공 횟수
- 동료 브레이크 기여 비중
- 정예 전투 시간
- 보스 패턴 노출 횟수와 종류
- 보스 브레이크 횟수
- 드랍·장착 횟수
- 사망·부활 횟수
- 귀환 성공 여부

### 2. 밸런스 원칙

- 세밀한 최종 밸런싱을 하지 않는다.
- 한 수단이 다른 수단을 완전히 지우는지만 검사한다.
- 일반 공격만으로 모든 상황을 해결할 수 있으면 실패.
- 회전베기만 반복해도 자원·쿨다운 압박이 없으면 실패.
- 돌진이 이동과 공격 양쪽에서 항상 최적이면 실패.
- 방어가 피격 비용을 지우면 실패.
- 처형 조건이 너무 자주 또는 전혀 발생하지 않으면 실패.
- 동료만으로 브레이크가 자동 완료되면 실패.
- 보스가 패턴을 두 종류 이하만 보여주고 죽으면 실패.

### 3. 회귀 실행 순서

한 번에 하나씩 실행한다.

```text
npm run typecheck
npm run test
npm run scenario
npm run build
npm run playtest:town
npm run playtest:zones
npm run playtest:record
```

브라우저 하니스는 Claude가 서버 하나만 사용해 실행한다.
시스템 작업자는 Claude가 실행 중인 서버와 포트를 건드리지 않는다.

### 4. 완료 보고 형식

```text
[패키지]
- 시스템 완료 / 기능 완료 / 차단
- 변경 파일
- 새 계약
- 조정한 상수
- 표적 테스트 결과
- 전체 회귀 결과와 실행 시각
- 실제 입력 검증 결과
- Claude가 이어서 할 표현 작업
- 알려진 위험과 다음 작업
```

---

## 6. 패키지별 의존성

| 패키지 | 선행 | 시스템 산출물 | Claude 산출물 | 완주 임계 경로 |
|---|---|---|---|---|
| S0 | 없음 | 안전 기준선 | 파일 충돌 확인 | 예 |
| S1 접사 | S0 | 파생 스탯·치명타 이벤트 | 상태창·치명타 연출 | 아니오 |
| S2 스킬 이벤트 | S1 이벤트 골격 | cast 상태·windup/release | 스킬별 표현 | 예 |
| S3 신규 스킬 | S2 | guard/execution 판정 | 애니·VFX·HUD | 아니오(현재 슬라이스 기준) |
| S4 소품 | S2 | 파괴 판정·이벤트 | 소품·파편·사운드 | 아니오 |
| S5 charger/정예 | S2 | 전용 AI·브레이크 | 실루엣·예고·충돌 연출 | 예 |
| S6 보스 | S2, S5 권장 | 순수 보스 상태 머신 | 텔레그래프·보스 표현 | 예 |
| S7 진행 | S5, S6 | 런 상태·보상·귀환 | 게이트·보상 표시 | 예 |
| S8 검증 | 모두 | 계측·회귀 | 녹화·시각 판정 | 예 |

---

## 7. 예상 작업량과 병목

한 명의 시스템 작업자 기준의 거친 범위다. 테스트와 인계 포함이며, Claude 표현 작업은 별도다.

| 패키지 | 예상 작업일 |
|---|---:|
| S0 | 0.25 |
| S1 | 1.5~2 |
| S2 | 1~1.5 |
| S3 | 1.5~2 |
| S4 | 1~1.5 |
| S5 | 1.5~2 |
| S6 | 2~3 |
| S7 | 1.5~2 |
| S8 | 1~1.5 |

총량은 약 11~16 시스템 작업일이다. 병렬 인원을 늘리는 것보다 다음 병목을 제거하는 것이 중요하다.

1. 이벤트 계약 없이 Claude가 상태를 역추론하는 문제
2. 시스템과 시각 코드가 같은 파일에 섞인 보스 구조
3. 한 기능을 끝내기 전에 다른 기능을 여는 WIP 증가
4. 테스트 통과를 플레이 품질 완료로 오해하는 보고 방식
5. 최초 Git 스냅샷 부재

---

## 8. 작업자가 판단하지 말고 리드에게 올릴 결정

다음은 구현자가 임의로 정하지 않는다.

- 기본 순서와 속도 우선 순서 중 어느 것을 사용할지
- guard/execution 최종 수치와 단축키
- 처형 대상 소실 시 자원 환불 여부
- 인벤토리가 가득 찬 상태의 보스 보상 처리
- 정예 브레이크를 charger에만 먼저 적용할지 모든 정예에 적용할지
- 보스방을 갱도 내부 아레나로 유지할지 별도 존으로 분리할지
- 신규 이벤트 버퍼를 `Resources`에 둘지 별도 런타임에 둘지

이 문서의 권장값은 구현을 시작할 수 있는 기본안이다. Claude가 다른 값을 승인하면
승인된 값을 보드에 기록하고 그 값을 단일 진실로 사용한다.

---

## 9. Definition of Done

### 시스템 패키지 DoD

- [ ] 판정이 DOM/WebGL 없이 실행됨
- [ ] 결정적 RNG 사용
- [ ] 새 상태의 생성·갱신·정리 경로 존재
- [ ] 의미 이벤트가 정확히 한 번 발생
- [ ] 단위 테스트에 정상·경계·실패 사례 포함
- [ ] 헤드리스 시나리오에서 실제 intent로 도달 가능
- [ ] 타입체크와 전체 단위 테스트 통과
- [ ] 파일·상수·계약·검증 결과가 보드에 기록됨

### 플레이어-facing 기능 DoD

- [ ] 시스템 패키지 DoD 충족
- [ ] Claude가 이벤트에 애니메이션·VFX·사운드·카메라·HUD를 연결
- [ ] 실제 입력으로 실행 가능
- [ ] 입력 후 100ms 첫 반응
- [ ] 24프레임 스트립에서 windup/impact/recovery 구분
- [ ] 콘솔 오류 0
- [ ] 최대 전투 밀도 성능 예산 확인
- [ ] 녹화 검토에서 해당 기능의 “밋밋함” 차단 항목이 없음

---

## 10. 계획 근거와 참조 원칙

이 계획은 다음 원칙을 적용한다.

- 작은 시스템 경계와 명시적 업데이트 순서
- 입력 → 상태 → 판정 → 의미 이벤트 → 표현의 단방향 흐름
- 한 메커니즘을 플레이 가능한 단위로 끝낸 뒤 다음 작업 착수
- 첫 30초의 선택, 압박, 보상, 회복 비트가 있는 조우 설계
- 입력 반응 → 모션 곡선 → 접촉 피드백 → 카메라 → 음향 동기화 순서의 게임 필
- 모든 난수와 시간축의 재현 가능성
- 브라우저 화면을 보지 않은 상태에서는 프리미엄·완료라고 주장하지 않음

참고한 설치 스킬 문서:

- `threejs-game-director/SKILL.md`
- `threejs-game-director/references/phase-playbook.md`
- `threejs-gameplay-systems/SKILL.md`
- `threejs-gameplay-systems/references/gameplay-workflows.md`
- `threejs-gameplay-systems/references/game-design-level-design.md`
- `threejs-gameplay-systems/references/game-feel.md`

이번 작업에서는 구현·브라우저 실행·외부 서비스·자격증명·에셋 생성을 수행하지 않았다.
