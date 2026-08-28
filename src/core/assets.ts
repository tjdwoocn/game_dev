import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js"
import type { ModelKind } from "./world"

export interface LoadedModel {
  scene: THREE.Group
  clips: THREE.AnimationClip[]
}

export type ModelRegistry = Partial<Record<ModelKind, LoadedModel>>

const CHARACTER_KINDS: ModelKind[] = [
  "player", "warrior", "archer", "boss",
  "companion-tank", "companion-striker", "companion-support",
]

/**
 * public/assets/models/{kind}.glb 를 시도 로드한다.
 * 파일이 없으면 해당 kind는 프리미티브 폴백으로 렌더된다 — 게임은 항상 실행 가능.
 */
export async function loadModelRegistry(): Promise<ModelRegistry> {
  const loader = new GLTFLoader()
  const registry: ModelRegistry = {}
  await Promise.all(
    CHARACTER_KINDS.map(async (kind) => {
      try {
        const gltf = await loader.loadAsync(`/assets/models/${kind}.glb`)
        registry[kind] = { scene: gltf.scene, clips: gltf.animations }
      } catch {
        // 폴백: 프리미티브 사용
      }
    }),
  )
  return registry
}

/** 스킨드 메시 안전 복제 (본 공유 문제 방지) */
export function instantiate(model: LoadedModel): THREE.Object3D {
  return skeletonClone(model.scene)
}
