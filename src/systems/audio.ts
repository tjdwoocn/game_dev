import type { CombatEvent } from "./combatEvents"

/**
 * 전투 사운드 — 전부 코드로 합성한다. 오디오 파일이 하나도 없다.
 *
 * **왜 절차적 합성인가.** 에셋을 받아 붙이면 라이선스·용량·버전 관리가 따라붙는다.
 * 오실레이터와 노이즈만으로 만들면 파일이 0개고, 값을 바꿔 바로 들어볼 수 있어
 * 타격감을 반복해서 조정하기에 오히려 낫다. 나중에 실제 녹음으로 바꾸더라도
 * 여기서 잡은 타이밍과 세기는 그대로 쓴다.
 *
 * **왜 관측으로 감지하는가.** 각 시스템에 `playSound()` 호출을 심으면 전투·스킬·루팅
 * 코드를 전부 건드려야 한다. 대신 이 시스템이 매 프레임 상태 변화를 읽어서 소리를 낸다
 * (hitFlash 가 새로 붙었다 = 맞았다, dead 가 붙었다 = 죽었다). 60Hz 라 지연은 16ms 이내고,
 * 다른 파일을 하나도 고치지 않는다.
 *
 * 오디오가 불가능한 환경(자동 재생 차단, WebAudio 미지원)에서도 게임은 그대로 돌아야 한다.
 * 이 모듈의 모든 실패는 조용히 무시된다 — 소리가 안 나는 것이 게임이 멈추는 것보다 낫다.
 */

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noise: AudioBuffer | null = null
let unavailable = false

/** 동시에 울리는 소리 수. 광역기로 8마리를 한 번에 때리면 소리가 뭉개진다. */
let voices = 0
const MAX_VOICES = 14
/** 같은 소리가 연달아 날 때의 최소 간격(초). 뭉침 방지. */
const lastPlayed = new Map<string, number>()

function ensureContext(): AudioContext | null {
  if (unavailable) return null
  if (ctx) {
    // 사용자 제스처 전에는 suspended 로 만들어진다. 매번 깨워 본다.
    if (ctx.state === "suspended") void ctx.resume().catch(() => {})
    return ctx
  }
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) { unavailable = true; return null }
    ctx = new Ctor()
    master = ctx.createGain()
    master.gain.value = 0.5
    master.connect(ctx.destination)

    // 화이트 노이즈 1초짜리. 타격음·바람소리의 재료다.
    const len = Math.floor(ctx.sampleRate)
    noise = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = noise.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    return ctx
  } catch {
    unavailable = true
    return null
  }
}

function envelope(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
}

interface ToneOpts {
  freq: number
  freqEnd?: number
  type?: OscillatorType
  gain?: number
  attack?: number
  decay?: number
  delay?: number
}

function tone(o: ToneOpts): void {
  const c = ensureContext()
  if (!c || !master || voices >= MAX_VOICES) return
  const t = c.currentTime + (o.delay ?? 0)
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = o.type ?? "sine"
  osc.frequency.setValueAtTime(o.freq, t)
  if (o.freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), t + (o.attack ?? 0.005) + (o.decay ?? 0.12))
  const attack = o.attack ?? 0.005
  const decay = o.decay ?? 0.12
  envelope(g, t, o.gain ?? 0.3, attack, decay)
  osc.connect(g).connect(master)
  voices++
  osc.onended = () => { voices-- }
  osc.start(t)
  osc.stop(t + attack + decay + 0.02)
}

interface NoiseOpts {
  freq: number
  freqEnd?: number
  q?: number
  filter?: BiquadFilterType
  gain?: number
  attack?: number
  decay?: number
  delay?: number
}

function noiseBurst(o: NoiseOpts): void {
  const c = ensureContext()
  if (!c || !master || !noise || voices >= MAX_VOICES) return
  const t = c.currentTime + (o.delay ?? 0)
  const src = c.createBufferSource()
  src.buffer = noise
  src.loop = true
  const bq = c.createBiquadFilter()
  bq.type = o.filter ?? "bandpass"
  bq.frequency.setValueAtTime(o.freq, t)
  bq.Q.value = o.q ?? 1
  const attack = o.attack ?? 0.004
  const decay = o.decay ?? 0.1
  if (o.freqEnd !== undefined) bq.frequency.exponentialRampToValueAtTime(Math.max(30, o.freqEnd), t + attack + decay)
  const g = c.createGain()
  envelope(g, t, o.gain ?? 0.25, attack, decay)
  src.connect(bq).connect(g).connect(master)
  voices++
  src.onended = () => { voices-- }
  src.start(t)
  src.stop(t + attack + decay + 0.02)
}

/**
 * 소리 사전. 값은 전부 귀로 맞춘 것이라 주석에 의도를 적어 둔다 —
 * 나중에 조정할 때 "왜 이 값인가" 를 모르면 다시 처음부터 더듬어야 한다.
 */
const SOUNDS: Record<string, (power: number) => void> = {
  /** 헛휘두르기. 짧은 바람소리. 맞았을 때의 타격음과 겹쳐도 지저분하지 않게 얇게 둔다. */
  swing: () => {
    noiseBurst({ freq: 1100, freqEnd: 380, q: 0.8, gain: 0.12, attack: 0.01, decay: 0.1 })
  },
  /** 타격. 낮은 몸통(thud) + 위쪽 딱(click). 둘이 같이 나야 "맞았다" 로 들린다. */
  hit: (p) => {
    tone({ freq: 150, freqEnd: 62, type: "sine", gain: 0.34 * p, attack: 0.003, decay: 0.11 })
    noiseBurst({ freq: 2400, q: 1.2, gain: 0.16 * p, attack: 0.002, decay: 0.045 })
  },
  /** 집중 공격(브레이크 중). 더 낮고 길게 — 세게 들어갔다는 신호다. */
  hitHeavy: (p) => {
    tone({ freq: 110, freqEnd: 44, type: "sine", gain: 0.44 * p, attack: 0.004, decay: 0.2 })
    noiseBurst({ freq: 1700, q: 0.9, gain: 0.24 * p, attack: 0.002, decay: 0.09 })
  },
  /** 적 사망. 아래로 흘러내리는 음 + 꼬리. */
  enemyDeath: (p) => {
    tone({ freq: 320, freqEnd: 78, type: "sawtooth", gain: 0.2 * p, attack: 0.006, decay: 0.3 })
    noiseBurst({ freq: 700, freqEnd: 180, q: 0.7, gain: 0.14 * p, attack: 0.01, decay: 0.32 })
  },
  /** 플레이어 피격. 다른 소리와 확실히 구분돼야 한다 — 거칠고 탁하게. */
  playerHurt: () => {
    tone({ freq: 210, freqEnd: 96, type: "square", gain: 0.24, attack: 0.004, decay: 0.18 })
    noiseBurst({ freq: 420, q: 0.6, gain: 0.18, attack: 0.003, decay: 0.14 })
  },
  /** 전리품 떨어짐. 밝은 핑 — 바닥에 뭔가 생겼다는 신호. */
  lootDrop: () => {
    tone({ freq: 880, freqEnd: 1180, type: "triangle", gain: 0.16, attack: 0.004, decay: 0.14 })
  },
  /** 획득. 두 음 상행. 짧은 보상감. */
  lootPickup: () => {
    tone({ freq: 660, type: "triangle", gain: 0.2, attack: 0.004, decay: 0.09 })
    tone({ freq: 990, type: "triangle", gain: 0.2, attack: 0.004, decay: 0.13, delay: 0.07 })
  },
  /** 약점 노출. 위로 올라가는 종소리 — "지금이다" 를 알린다. */
  breakOpen: () => {
    tone({ freq: 520, freqEnd: 880, type: "sine", gain: 0.22, attack: 0.01, decay: 0.3 })
    tone({ freq: 1040, freqEnd: 1760, type: "sine", gain: 0.09, attack: 0.01, decay: 0.28 })
  },
  /** 브레이크 성공. 이 게임에서 가장 큰 순간이라 가장 두껍게 만든다. */
  breakSuccess: () => {
    tone({ freq: 90, freqEnd: 40, type: "sine", gain: 0.5, attack: 0.005, decay: 0.5 })
    noiseBurst({ freq: 3200, freqEnd: 600, q: 0.5, gain: 0.3, attack: 0.004, decay: 0.45 })
    tone({ freq: 620, freqEnd: 1240, type: "triangle", gain: 0.18, attack: 0.02, decay: 0.4, delay: 0.03 })
  },
  /** 레벨업. 3음 상행 아르페지오. */
  levelUp: () => {
    tone({ freq: 523, type: "triangle", gain: 0.22, attack: 0.008, decay: 0.16 })
    tone({ freq: 659, type: "triangle", gain: 0.22, attack: 0.008, decay: 0.16, delay: 0.1 })
    tone({ freq: 880, type: "triangle", gain: 0.26, attack: 0.008, decay: 0.34, delay: 0.2 })
  },
  /** 돌진. 앞으로 튀어나가는 바람. */
  dash: () => {
    noiseBurst({ freq: 300, freqEnd: 1500, q: 0.7, gain: 0.2, attack: 0.01, decay: 0.16 })
  },
  /**
   * 회전베기. 몸을 돌려 휘두르는 소리 — 기본 공격의 "툭" 과 확실히 달라야 한다.
   * 휘두름(상승 노이즈) 두 겹을 어긋나게 겹쳐 회전을 만들고, 낮은 몸통을 깔아 무게를 준다.
   */
  whirlwind: () => {
    noiseBurst({ freq: 420, freqEnd: 2400, q: 1.1, gain: 0.22, attack: 0.012, decay: 0.2 })
    noiseBurst({ freq: 380, freqEnd: 1900, q: 1.3, gain: 0.16, attack: 0.012, decay: 0.22, delay: 0.09 })
    tone({ freq: 132, freqEnd: 88, type: "sawtooth", gain: 0.16, attack: 0.01, decay: 0.28 })
  },
  /** 보스 패턴 예고. 낮게 울리는 경고음 — 피하라는 뜻이다. */
  bossTelegraph: () => {
    tone({ freq: 74, freqEnd: 58, type: "sawtooth", gain: 0.3, attack: 0.03, decay: 0.5 })
    tone({ freq: 148, freqEnd: 116, type: "sine", gain: 0.14, attack: 0.03, decay: 0.45 })
  },
}

/** 같은 소리가 겹쳐 뭉치지 않도록 최소 간격을 둔다(초). */
const THROTTLE: Record<string, number> = {
  hit: 0.035, hitHeavy: 0.04, swing: 0.06, enemyDeath: 0.05,
  playerHurt: 0.15, lootDrop: 0.04, lootPickup: 0.05, whirlwind: 0.12,
}

export function playSound(name: keyof typeof SOUNDS | string, power = 1): void {
  const fn = SOUNDS[name]
  if (!fn) return
  const c = ensureContext()
  if (!c) return
  const gap = THROTTLE[name]
  if (gap !== undefined) {
    const prev = lastPlayed.get(name) ?? -Infinity
    if (c.currentTime - prev < gap) return
    lastPlayed.set(name, c.currentTime)
  }
  try { fn(power) } catch { /* 소리 하나 실패로 게임이 멈추면 안 된다 */ }
}

export function setAudioVolume(v: number): void {
  ensureContext()
  if (master) master.gain.value = Math.max(0, Math.min(1, v))
}

/**
 * 전투 이벤트 하나를 소리로 옮긴다.
 *
 * 감지는 `combatEvents.ts` 가 한다 — 소리와 이펙트가 같은 신호를 봐야 둘이 갈라지지 않는다.
 * 여기서는 "이 이벤트에 어떤 소리인가" 만 정한다.
 */
export function playCombatEvent(evt: CombatEvent): void {
  playSound(evt.kind, evt.power)
}
