# 캐릭터 모델 에셋

이 폴더의 `.glb` 파일은 게임 시작 시 자동 로드됩니다. 파일이 없으면 해당 캐릭터는
도형 프리미티브로 렌더되며, 게임은 항상 실행 가능합니다.

## 파일명 규약

| 파일 | 용도 | 현재 에셋 |
|---|---|---|
| `player.glb` | 플레이어(전사) | KayKit Adventurers — Barbarian |
| `warrior.glb` | 근접 적 | KayKit Skeletons — Skeleton_Warrior |
| `archer.glb` | 원거리 적 | KayKit Skeletons — Skeleton_Rogue |
| `boss.glb` | 보스 | KayKit Skeletons — Skeleton_Mage |

교체 조건: 애니메이션 클립 이름에 `Idle`, `Walk`(또는 `Run`), `Attack`, `Death`가
부분 일치로 포함된 리깅된 glTF 바이너리(.glb). 모델 전방이 -Z이면 그대로 사용
가능(코드에서 보정), 크기는 자동 정규화됩니다.

## 출처 / 라이선스

- KayKit Character Pack: Adventurers / Skeletons — Kay Lousberg (www.kaylousberg.com)
- 라이선스: CC0 (동봉된 LICENSE-*.txt 참조). 크레딧 표기는 선택이지만 권장.

## 추가 무료 에셋 소스

- https://kaylousberg.itch.io/ (KayKit 시리즈 — 던전 타일, 무기 등)
- https://quaternius.com/ (Ultimate RPG Pack 등, CC0)
- https://kenney.nl/assets (Kenney, CC0)
