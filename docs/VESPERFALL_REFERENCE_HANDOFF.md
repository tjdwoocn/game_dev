# Vesperfall 레퍼런스 기반 공동 작업 인계

작성: Codex  
기준일: 2026-08-28  
목적: `Vesperfall — The Three Tolls`의 완성도와 제작 방식을 현재 ARPG 세로 슬라이스에 적용

## 1. 레퍼런스에서 가져올 것

이 레퍼런스의 핵심은 특정 모델이나 화면을 복사하는 것이 아니다. 다음 네 가지를
하나의 플레이 경험으로 묶는 제작 방식이 핵심이다.

1. **플레이어-facing 루프**: 시작 → 클래스/장비 정체성 → 이동·전투 → 위협 읽기 → 보상 →
   진행 상태 저장 → 다음 도전.
2. **명시적 전투 언어**: 공격의 준비·발동·회복, 적의 의도·간격·텔레그래프·대응 선택을
   상태와 이벤트로 분리한다.
3. **상태를 설명하는 표현**: HUD, 소리, VFX, 카메라, 월드 소품이 동일한 의미 이벤트를
   소비한다. 피해 숫자만 늘어나는 것이 아니라 무엇이 일어났는지를 즉시 보여준다.
4. **정직한 에셋 관리**: 실제 런타임 에셋, 폴백, 리뷰 전용 이미지, 출처·라이선스·제약을
   구분한다. 카탈로그에 적힌 경로를 실제 사용 중인 모델로 오인하지 않는다.

참조:

- [Vesperfall demo](https://vesperfall.mengto.chatgpt.site/)
- [Vesperfall Asset Ledger](https://vesperfall.mengto.chatgpt.site/asset-catalog)
- [MengTo Game Development Skills](https://github.com/MengTo/Skills/tree/main/agent-skills/game-development)

## 2. 우리 프로젝트의 목표 세로 슬라이스

범위를 늘리지 않고 다음 한 판을 완성한다.

```text
등불 마을
  → 문지기 메뉴
  → 무너진 갱도 입구
  → 교전 1: warrior + charger 학습
  → 교전 2: archer 압박 + 이동 선택
  → 정예 교전: 브레이크와 보상
  → 보스방: 기존 스킬 조합
  → 보스 보상/장착
  → 마을 귀환/상태 유지
```

이번 단계에서 새 존·새 클래스·대규모 아이템 카탈로그를 추가하지 않는다.
한 장면의 완성도를 높인 뒤에 콘텐츠를 확장한다.

## 3. 이번 Codex 시스템 작업

### 돌진형 적 행동 계약

`charger`는 일반 근접 적과 같은 추격만 하지 않는다.

```text
대상 선택
  → windup 0.42초: 방향 고정, 취소 가능, 텔레그래프
  → active 0.34초: 직선 이동, 벽에서 정지, 경로 접촉 1회
  → recovery 0.50초: 재사용 전 회복
```

초기 콘텐츠 수치:

- 최소 시도 거리 3.2
- 최대 시도 거리 9
- 돌진 속도 15
- 경로 반폭 0.62
- 피해 배율 1.0 (기본 피해 9를 유지해 초기 슬라이스를 압도하지 않음)
- 기본 재사용 대기시간 3.4초

수정 영역:

- `src/core/world.ts`: 적 행동 상태와 `EnemyActionState`
- `src/core/events.ts`: `enemyAction` 이벤트와 행동 인스턴스 시퀀스
- `src/content/enemies.ts`: charger 행동 수치
- `src/systems/ai.ts`: windup/active/recovery 전이와 취소
- `src/systems/movement.ts`: 벽을 고려한 직선 돌진
- `src/systems/combat.ts`: 실제 진행 경로 기준의 단일 접촉 판정
- `src/systems/combatEvents.ts`: 첫 windup을 기존 텔레그래프 훅으로 전달
- `tests/charger.test.ts`: 정상·취소·벽 너머·단일 접촉 검증

시스템 검증은 `tests/charger.test.ts` 4건 통과, 타입체크 통과 상태다.
플레이어-facing 완료는 Claude의 표현 연결과 실제 브라우저 검증 이후로 간주한다.

### 기존 S4 시스템 작업 상태

부술 수 있는 소품도 작업 트리에 포함되어 있다.

- `DestructibleComp`와 소품 피해 라우팅
- 파괴 시 `propBreak` 이벤트
- 파괴 후 충돌 제거
- seeded 소품 드랍
- 존 전환 시 정리

이 기능은 `tests/destructibles.test.ts` 5건으로 보호한다. Claude는 소품의 실제
파괴 모델 교체, 파편·먼지·드랍 오라 표현을 연결한다.

## 4. Claude 담당 작업

### P0 — 돌진형 적을 화면에서 읽히게 만들기

현재 첫 시스템 버전은 기존 `bossTelegraph` 표현 훅을 windup에 재사용한다.
그러므로 우선 이 훅에서 다음을 보여준다.

- charger 머리 위 또는 바닥의 방향성 텔레그래프
- 돌진 방향을 나타내는 길쭉한 위험 영역
- windup 중 방향 고정과 취소 시 즉시 정리
- active 순간의 잔상·먼지·충돌 스파크
- `playerHurt`와 구분되는 charger 전용 충돌음

더 세밀한 표현이 필요하면 `CombatEventKind`에 `enemyWindup`, `enemyRelease`,
`enemyRecovery`를 추가한다. 그 경우 `tests/presentation.coverage.test.ts`의 모든
표현 테이블도 같은 변경에서 갱신한다. 이벤트를 추가하고 시각 매핑을 나중에 하는
중간 상태는 병합하지 않는다.

### P0 — 에셋 카탈로그

`docs/ASSET_CATALOG.md` 또는 `src/content/assetCatalog.ts`를 추가한다. 최소 필드:

```ts
type AssetStatus = "runtime" | "fallback" | "review-only" | "missing"

interface AssetEntry {
  id: string
  category: "character" | "enemy" | "boss" | "prop" | "item" | "vfx" | "audio" | "ui"
  status: AssetStatus
  path?: string
  factory?: string
  usedBy: string[]
  source: string
  license: string
  notes: string
}
```

특히 다음을 실제 상태대로 구분한다.

- KayKit/기존 모델이 실제 런타임에 사용되는지
- 절차 생성 폴백인지
- 리뷰용 PNG인지
- 스킬별 VFX가 실제로 연결되었는지
- 사운드가 합성음인지 외부 파일인지

외부 에셋을 사용할 때는 라이선스를 확인하고, 레퍼런스 사이트의 이미지나 모델을
자동으로 재사용한다고 가정하지 않는다.

### P1 — 갱도 시각 세로 슬라이스

- warrior, archer, charger 세 종을 색만이 아니라 실루엣과 움직임으로 구분
- 정예 표식은 별도 실루엣·테두리·명칭으로 표현
- 보스는 일반 적보다 크기·머리 형태·무기·애니메이션·텔레그래프가 모두 달라야 함
- 교전 사이에 안전한 회복 비트와 목적지를 보이는 랜드마크 배치
- 파괴 가능 소품에 파편, 먼지, 드랍 오라 연결

### P1 — 스킬/장비/보상 표현

- 기본 공격·회전베기·돌진·방어·처형의 준비/발동/회복을 서로 다른 동작으로 표현
- `skillCast.castId`와 `enemyAction.instanceId`를 사용해 같은 행동의 연출을 묶음
- 스킬별 색·궤적·충격 형태·소리를 분리
- 장착 아이템은 월드 드랍 형태와 HUD 아이콘이 동일한 정체성을 가져야 함
- 치명타, 브레이크, 처치, 레벨업, 아이템 획득의 피드백 계층을 분리

### P1 — HUD와 리뷰 화면

- 생존 상태: HP, 분노, 현재 행동, 피격 방향
- 전투 상태: 스킬 쿨다운·자원·시전 준비·브레이크·보스 패턴
- 진행 상태: 현재 존, 목표, 보상, 귀환 가능 여부
- `M/C/K` 패널이 플레이 화면을 가리지 않고 모바일 폭에서도 줄바꿈·겹침이 없음
- 동일한 seed와 named view로 마을·갱도 입구·charger windup·보스·보상 장면을 재현

## 5. Codex 후속 시스템 작업

Claude의 P0 표현 연결이 끝나면 다음 순서로 이어간다.

1. **S5 마무리**: charger 정예 수식어와 브레이크 상호작용, 행동 계측값 추가
2. **S6**: 보스의 시뮬레이션 상태 머신과 Three.js 텔레그래프 소유권 분리
3. **S7**: 갱도 교전 ID, 정예/보스 활성 조건, 보상 중복 방지, 귀환 가능 상태
4. **S7 보강**: 로컬 저장·불러오기 계약, 실패/재시작, 레벨·인벤토리·장비 유지
5. **S8**: 동일 seed의 녹화·스크린샷·전투 계측과 한 판 완주 검증

시스템은 계속 DOM/WebGL에 의존하지 않고, 모든 랜덤은 `Resources.rng`를 사용한다.

## 6. 완료 판정

다음 여섯 항목이 모두 통과하기 전에는 “레퍼런스 수준 완성”이라고 보고하지 않는다.

- 첫 입력 후 100ms 안에 시각적 반응
- charger를 포함한 일반 교전에서 공격·피격·회피·보상 선택이 실제로 발생
- 각 이벤트에 의미가 겹치지 않는 VFX·사운드·HUD 반응
- 갱도 입구에서 보스 처치와 보상 수령을 거쳐 마을로 귀환
- 같은 seed와 입력에서 시스템 결과와 리뷰 장면이 재현
- 데스크톱·모바일 프레임과 전투 최대 밀도에서 콘솔 오류 0, 성능 예산 준수

## 7. 파일 경계

### Codex

`src/core/*`, `src/systems/ai.ts`, `combat.ts`, `combatEvents.ts`, `movement.ts`,
`skills.ts`, `boss.ts`, `loot.ts`, `progression.ts`, `src/scenario/*`, 시스템 테스트.

### Claude

`src/systems/render.ts`, `combatVfx.ts`, `audio.ts`, `enemyVisuals.ts`,
`dungeonProps.ts`, `dungeonDressing.ts`, `src/ui/*`, `src/style.css`, 에셋 카탈로그,
시각·오디오 브라우저 검증.

공유 파일은 작업 시작 전에 보드에 예약한다. 시스템 이벤트가 추가되면 Claude가 같은
패키지에서 표현 매핑과 `presentation.coverage`를 갱신한다.
