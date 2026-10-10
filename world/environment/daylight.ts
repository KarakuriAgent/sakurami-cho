import * as THREE from 'three'
import { CABLE } from '../../core/town'
import { labNow, type LabTime } from '../../core/clock'
import { directionFromAltAz, sunPosition, type SunPosition } from './sun'

/**
 * 時刻で変わる「外」の見た目と光（空の色・太陽の光・町の灯り・部屋に入る外の光）。
 * 毎コマ updateOutdoor() を呼ぶ（町の毎コマの初め town.begin。world/createTown.ts）。空・遠景・外の光（outdoor/sky.ts・landscape.ts・outdoorLighting.ts）は、そのあと毎コマこの値（outdoor）を読む。
 *
 * 色の基準は設定資料 vol2「第5章 時間帯と天気による町の色」の表:
 * - 早朝（5〜7時）: 薄い桃色から水色 / 朝（7〜9時）: 澄んだ青 / 昼: 青
 * - 夕方（16〜18時）: 橙から紫のグラデーション、雲が金に縁取られる / 宵（18〜20時）: 群青
 * - 夜（20〜24時）: 濃紺に星 / 深夜（0〜3時）: 漆黒に近い紺
 * 空の色は太陽の高度（度）ごとの表を補間する（朝と夕方で表を分ける）。町の灯りの数は日本時間の時刻で決める
 * （宵は多く、深夜はまばらで港の作業灯と灯台だけが残る）。
 */

/* -------------------------------------------------------------------------- */
/* 表の補間                                                                     */
/* -------------------------------------------------------------------------- */

const lin = (hex: string, scale = 1) => new THREE.Color(hex).multiplyScalar(scale)

/** [x, 値] の表を x で線形補間する（x は昇順） */
function interp(keys: readonly (readonly [number, number])[], x: number): number {
  if (x <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i++) {
    if (x <= keys[i][0]) {
      const [x0, y0] = keys[i - 1]
      const [x1, y1] = keys[i]
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
    }
  }
  return keys[keys.length - 1][1]
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/* -------------------------------------------------------------------------- */
/* 空の色の表（太陽の高度ごと。色は sRGB の 16 進で書き、明るさは scale で付ける）    */
/* -------------------------------------------------------------------------- */

interface SkyKey {
  alt: number
  zenith: string
  mid: string
  horizon: string
  /** 太陽の側の地平線の光（足し算） */
  glow: string
  /** 全体の明るさ */
  scale: number
}

interface SkyColors {
  zenith: THREE.Color
  mid: THREE.Color
  horizon: THREE.Color
  glow: THREE.Color
}

function buildKeys(keys: SkyKey[]): (SkyColors & { alt: number })[] {
  return keys.map((k) => ({
    alt: k.alt,
    zenith: lin(k.zenith, k.scale),
    mid: lin(k.mid, k.scale),
    horizon: lin(k.horizon, k.scale),
    glow: lin(k.glow, k.scale),
  }))
}

/** 夕方（太陽が西にあるとき）: 昼の青 → 橙から紫 → 宵の群青 → 夜の濃紺 */
const EVENING = buildKeys([
  { alt: -90, zenith: '#0a1234', mid: '#13204a', horizon: '#1e3060', glow: '#000000', scale: 0.85 },
  { alt: -18, zenith: '#0a1234', mid: '#13204a', horizon: '#1e3060', glow: '#000000', scale: 0.85 },
  { alt: -14, zenith: '#0e1840', mid: '#172656', horizon: '#243668', glow: '#000000', scale: 0.85 },
  { alt: -10, zenith: '#122058', mid: '#1f2e6c', horizon: '#323866', glow: '#0a0406', scale: 0.8 },
  { alt: -7, zenith: '#1a2a6c', mid: '#34397a', horizon: '#64466a', glow: '#2a0e0c', scale: 0.95 },
  { alt: -4, zenith: '#233478', mid: '#56468a', horizon: '#a65a52', glow: '#5a1c0e', scale: 1.0 },
  { alt: -1.5, zenith: '#2b3c84', mid: '#7a5a96', horizon: '#dc7446', glow: '#8a2c10', scale: 1.0 },
  { alt: 1, zenith: '#33498f', mid: '#8a6fa0', horizon: '#f08a48', glow: '#a03c12', scale: 1.0 },
  { alt: 4, zenith: '#3a5aa4', mid: '#8e8eb8', horizon: '#f0aa6a', glow: '#8a4a18', scale: 1.0 },
  { alt: 9, zenith: '#3a66b8', mid: '#7ea0cc', horizon: '#dac8aa', glow: '#5a3a1a', scale: 1.0 },
  { alt: 18, zenith: '#3068c2', mid: '#679ad6', horizon: '#b8d0e6', glow: '#3a2a16', scale: 1.0 },
  { alt: 35, zenith: '#2a62c4', mid: '#5c94db', horizon: '#aacbea', glow: '#2e2618', scale: 1.0 },
  { alt: 90, zenith: '#2a62c4', mid: '#5c94db', horizon: '#aacbea', glow: '#2e2618', scale: 1.0 },
])

/**
 * 夕方の空の、町（外）を描く分（段階 5 の色の仕上げ。docs/design/town.md §7 の 105）。
 * 上の EVENING は部屋に入る外の光（ラボの中の配信の画）が使う値なので変えずに残し、外の空・町を照らす光はこちらを使う。
 * 中ほどの空の赤紫（#8a6fa0 など）を青紫へ寄せ、地平線は桃色より金と橙に。日の入りの後の紫はそのまま残す
 */
const EVENING_OUT = buildKeys([
  { alt: -90, zenith: '#0a1234', mid: '#13204a', horizon: '#1e3060', glow: '#000000', scale: 0.85 },
  { alt: -18, zenith: '#0a1234', mid: '#13204a', horizon: '#1e3060', glow: '#000000', scale: 0.85 },
  { alt: -14, zenith: '#0e1840', mid: '#172656', horizon: '#243668', glow: '#000000', scale: 0.85 },
  { alt: -10, zenith: '#122058', mid: '#1f2e6c', horizon: '#323866', glow: '#0a0406', scale: 0.8 },
  { alt: -7, zenith: '#1a2a6c', mid: '#34397a', horizon: '#5e4668', glow: '#2a100a', scale: 0.95 },
  { alt: -4, zenith: '#22357a', mid: '#4e4a8a', horizon: '#9c5e4c', glow: '#5a240c', scale: 1.0 },
  { alt: -1.5, zenith: '#293f8a', mid: '#6a619a', horizon: '#d47c40', glow: '#8a3810', scale: 1.0 },
  { alt: 1, zenith: '#304b93', mid: '#7a7aa8', horizon: '#ec9546', glow: '#a04c14', scale: 1.0 },
  { alt: 4, zenith: '#3858a6', mid: '#8796bc', horizon: '#eeb26e', glow: '#8a5418', scale: 1.0 },
  { alt: 9, zenith: '#3a66b8', mid: '#7ea2cc', horizon: '#d8caa8', glow: '#5a3c1a', scale: 1.0 },
  { alt: 18, zenith: '#3068c2', mid: '#679ad6', horizon: '#b8d0e6', glow: '#3a2a16', scale: 1.0 },
  { alt: 35, zenith: '#2a62c4', mid: '#5c94db', horizon: '#aacbea', glow: '#2e2618', scale: 1.0 },
  { alt: 90, zenith: '#2a62c4', mid: '#5c94db', horizon: '#aacbea', glow: '#2e2618', scale: 1.0 },
])

/** 朝（太陽が東にあるとき）: 夜 → 薄い桃色から水色 → 澄んだ青 */
const MORNING = buildKeys([
  { alt: -90, zenith: '#0a1234', mid: '#13204a', horizon: '#1e3060', glow: '#000000', scale: 0.85 },
  { alt: -18, zenith: '#0a1234', mid: '#13204a', horizon: '#1e3060', glow: '#000000', scale: 0.85 },
  { alt: -13, zenith: '#0e1844', mid: '#182654', horizon: '#2a3462', glow: '#000000', scale: 0.85 },
  { alt: -9, zenith: '#172664', mid: '#2c3a78', horizon: '#56487a', glow: '#120810', scale: 0.85 },
  { alt: -5.5, zenith: '#26387e', mid: '#5a5e98', horizon: '#b07a8c', glow: '#3a1820', scale: 1.0 },
  { alt: -2, zenith: '#3f62a6', mid: '#8e9ac6', horizon: '#eeb2aa', glow: '#5a2a20', scale: 1.0 },
  { alt: 1, zenith: '#4f80c6', mid: '#a4c2e2', horizon: '#f6c6aa', glow: '#7a4220', scale: 1.0 },
  { alt: 4, zenith: '#4c84cc', mid: '#98c2e8', horizon: '#eed6bf', glow: '#5a3a1c', scale: 1.0 },
  { alt: 10, zenith: '#3f7ece', mid: '#80b4e6', horizon: '#d2e0e6', glow: '#3e3020', scale: 1.0 },
  { alt: 20, zenith: '#3274d0', mid: '#6aa6e2', horizon: '#bad6ee', glow: '#32281a', scale: 1.0 },
  { alt: 35, zenith: '#2a62c4', mid: '#5c94db', horizon: '#aacbea', glow: '#2e2618', scale: 1.0 },
  { alt: 90, zenith: '#2a62c4', mid: '#5c94db', horizon: '#aacbea', glow: '#2e2618', scale: 1.0 },
])

/** 深夜（0〜3 時）の空: 漆黒に近い紺（夜の濃紺から、時刻でここへ寄せる） */
const DEEP_NIGHT: SkyColors = {
  zenith: lin('#03060f', 0.8),
  mid: lin('#070d20', 0.8),
  horizon: lin('#0e1830', 0.8),
  glow: lin('#000000'),
}

/** 太陽の光（直射）の色と強さ（高度ごと） */
const SUN_COLOR_KEYS: [number, string][] = [
  [-2, '#ff5a28'],
  [0, '#ff7a40'],
  [2, '#ff9c5c'],
  [6, '#ffc28a'],
  [15, '#ffdfb8'],
  [30, '#fff0dc'],
  [60, '#fff6ec'],
]
const SUN_COLORS = SUN_COLOR_KEYS.map(([alt, hex]) => [alt, new THREE.Color(hex)] as const)
/**
 * 町（外）を照らす太陽の色（段階 5 の色の仕上げ）。低い太陽は赤より金と橙に（ACES のトーンマッピングで赤が桃色に寄るので、
 * 地面と白い壁が桃色一色にならないように）。部屋に入る光は上の SUN_COLOR_KEYS のまま
 */
const OUT_SUN_COLOR_KEYS: [number, string][] = [
  [-2, '#ff7034'],
  [0, '#ff9048'],
  [2, '#ffad66'],
  [6, '#ffca8e'],
  [15, '#ffe2bc'],
  [30, '#fff0dc'],
  [60, '#fff6ec'],
]
const OUT_SUN_COLORS = OUT_SUN_COLOR_KEYS.map(([alt, hex]) => [alt, new THREE.Color(hex)] as const)
const SUN_STRENGTH: [number, number][] = [
  [-1.2, 0],
  [0, 0.28],
  [3, 0.55],
  [8, 0.82],
  [20, 1],
  [90, 1],
]

function sunColorAt(alt: number, out: THREE.Color, colors: readonly (readonly [number, THREE.Color])[] = SUN_COLORS) {
  if (alt <= colors[0][0]) return out.copy(colors[0][1])
  for (let i = 1; i < colors.length; i++) {
    if (alt <= colors[i][0]) {
      const [a0, c0] = colors[i - 1]
      const [a1, c1] = colors[i]
      return out.copy(c0).lerp(c1, (alt - a0) / (a1 - a0))
    }
  }
  return out.copy(colors[colors.length - 1][1])
}

/** 色の彩度を s 倍にする（明るさ（輝度）は保つ） */
function saturate(c: THREE.Color, s: number) {
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
  c.r = Math.max(0, l + (c.r - l) * s)
  c.g = Math.max(0, l + (c.g - l) * s)
  c.b = Math.max(0, l + (c.b - l) * s)
  return c
}
const luminance = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b

/* -------------------------------------------------------------------------- */
/* 町の灯り（日本時間の時刻ごとの、点いている割合）                                 */
/* -------------------------------------------------------------------------- */

/** 家の窓明かり: 宵は多く、深夜はまばら */
const WINDOW_BY_HOUR: [number, number][] = [
  [0, 0.17],
  [1, 0.11],
  [2, 0.08],
  [3, 0.06],
  [4, 0.08],
  [5, 0.16],
  [6, 0.24],
  [7, 0.18],
  [8, 0.08],
  [10, 0.03],
  [14, 0.04],
  [16, 0.3],
  [17, 0.62],
  [18, 0.86],
  [19, 0.92],
  [20, 0.86],
  [21, 0.74],
  [22, 0.56],
  [23, 0.34],
  [24, 0.17],
]

/** 街灯: 暗くなると点く。深夜は町の灯りがまばらになる（設定の第5章）ので、半分ほどに減らす */
const STREET_BY_HOUR: [number, number][] = [
  [0, 0.55],
  [1, 0.46],
  [2, 0.42],
  [4, 0.42],
  [5, 0.6],
  [6, 0.85],
  [7, 1],
  [21, 1],
  [22, 0.9],
  [23, 0.72],
  [24, 0.55],
]

/** 事務所・学校・ラボ・港の建物の窓: 夕方から宵がいちばん多く、夜は残業の窓が少し残る */
const OFFICE_BY_HOUR: [number, number][] = [
  [0, 0.1],
  [5, 0.07],
  [7, 0.18],
  [9, 0.3],
  [16, 0.5],
  [17, 0.78],
  [18, 0.84],
  [19, 0.72],
  [20, 0.55],
  [21, 0.4],
  [22, 0.26],
  [23, 0.15],
  [24, 0.1],
]

/** 1 階の店（ショーウィンドウ・高架のアーチの店）: 宵がいちばん明るく、22 時を過ぎると閉まっていく */
const SHOP_BY_HOUR: [number, number][] = [
  [0, 0.12],
  [2, 0.05],
  [6, 0.08],
  [8, 0.3],
  [10, 0.65],
  [16, 0.85],
  [18, 1],
  [20, 0.95],
  [21, 0.75],
  [22, 0.5],
  [23, 0.28],
  [24, 0.12],
]

/** 町の外（湾の向こうの半島の集落）の灯り */
const FAR_BY_HOUR: [number, number][] = [
  [0, 0.45],
  [2, 0.32],
  [4, 0.34],
  [6, 0.6],
  [8, 0.4],
  [16, 0.6],
  [19, 1],
  [22, 0.8],
  [24, 0.45],
]

/* -------------------------------------------------------------------------- */
/* 外の状態                                                                     */
/* -------------------------------------------------------------------------- */

export interface Outdoor {
  /** 何回更新したか（変わったかを見る用） */
  version: number
  time: LabTime
  sun: SunPosition
  /** ラボから太陽へ向かう向き（シーンの座標、単位ベクトル） */
  sunDir: THREE.Vector3

  /* 空（リニアの色） */
  zenith: THREE.Color
  mid: THREE.Color
  horizon: THREE.Color
  /** 太陽と反対側の地平線の色（朝夕は、太陽の側の橙・桃色に対して、反対側は青紫） */
  horizonAnti: THREE.Color
  glow: THREE.Color
  /** 太陽の円盤（HDR。Bloom でにじむ） */
  sunDisc: THREE.Color
  /** 星の見え方（0〜1） */
  stars: number
  /** 雲の光が当たる側・影の側の色と、雲の量（0〜1） */
  cloudLit: THREE.Color
  cloudShade: THREE.Color
  cloudCover: number
  /** 夜の町の明かりで地平線がほんのり明るくなる色（町の方角だけ） */
  cityGlow: THREE.Color

  /* 遠景の光（リニア） */
  /** 太陽の直射（色 × 強さ） */
  sunLight: THREE.Color
  /** 空からの光（上から） */
  skyLight: THREE.Color
  /** 遠くほど溶け込む空気の色と、溶け込む距離（m。この距離で約 63%） */
  haze: THREE.Color
  hazeDistance: number
  /** 海の水の色 */
  water: THREE.Color

  /** 昼の明るさ（0 = 夜、1 = 昼） */
  daylight: number
  /** 夜の暗さ（0 = 昼、1 = 夜） */
  night: number
  /** 深夜（0〜3 時ごろ）の度合い */
  deepNight: number

  /** 町の灯り: 点いている割合（0〜1）。家の窓・事務所の窓・1 階の店・街灯・港の作業灯・小径と石段の足元灯・町の外の集落・ケーブルカー */
  lights: { window: number; office: number; shop: number; street: number; port: number; path: number; far: number; cable: number }
  /** 町の灯りの明るさの倍率（薄明のうちは控えめ） */
  lightGain: number
  /** ガーデンドームの葉脈ライティング（0〜1）・ソラノワの LED（営業 11:00〜22:00 の暗い間）・灯台（日没〜日の出）・駅の時計の明かり */
  dome: number
  soranowa: number
  lighthouse: number
  clockFace: number
  /** ケーブルカーが動いている時間か（0〜1。車両の位置は world/outdoor/transit/cable.ts が交通の時計で決める） */
  cableRunning: number
  /** 季節: 紅葉（楓坂の楓）・桜の度合い（0〜1） */
  autumn: number
  spring: number
  /** 潮位（0〜1。ソラノワの外周の光の高さ） */
  tide: number

  /* 部屋に入る外の光 */
  interior: {
    /** 太陽の直射（DirectionalLight）の強さと色 */
    sun: number
    sunColor: THREE.Color
    /** 外からの弱い環境光（半球光）の強さ・空の色（明るさ 1 にそろえた色）・地面の色 */
    ambient: number
    ambientSky: THREE.Color
    ambientGround: THREE.Color
    /** 反射用の環境（Lightformer）の、ガラス壁の上半分（空）と下半分（町・地面）の色 × 強さ */
    envSky: THREE.Color
    envGround: THREE.Color
    /** 外に面したガラスの不透明度（昼は少し暗くする） */
    glassOpacity: number
  }
}

export const outdoor: Outdoor = {
  version: 0,
  time: labNow(),
  sun: { altitude: 0, azimuth: 180, declination: 0 },
  sunDir: new THREE.Vector3(0, 1, 0),
  zenith: new THREE.Color(),
  mid: new THREE.Color(),
  horizon: new THREE.Color(),
  horizonAnti: new THREE.Color(),
  glow: new THREE.Color(),
  sunDisc: new THREE.Color(),
  stars: 0,
  cloudLit: new THREE.Color(),
  cloudShade: new THREE.Color(),
  cloudCover: 0.32,
  cityGlow: new THREE.Color(),
  sunLight: new THREE.Color(),
  skyLight: new THREE.Color(),
  haze: new THREE.Color(),
  hazeDistance: 8000,
  water: new THREE.Color(),
  daylight: 0,
  night: 1,
  deepNight: 0,
  lights: { window: 0, office: 0, shop: 0, street: 0, port: 0, path: 0, far: 0, cable: 0 },
  lightGain: 1,
  dome: 0,
  soranowa: 0,
  lighthouse: 0,
  clockFace: 0,
  cableRunning: 0,
  autumn: 0,
  spring: 0,
  tide: 0.5,
  interior: {
    sun: 0,
    sunColor: new THREE.Color(),
    ambient: 0,
    ambientSky: new THREE.Color(),
    ambientGround: new THREE.Color(),
    envSky: new THREE.Color(),
    envGround: new THREE.Color(),
    glassOpacity: 0.22,
  },
}

const _a: SkyColors = { zenith: new THREE.Color(), mid: new THREE.Color(), horizon: new THREE.Color(), glow: new THREE.Color() }
/** 部屋に入る外の光の計算に使う空（元の表。ラボの中の配信の画を変えないため） */
const _raw: SkyColors = { zenith: new THREE.Color(), mid: new THREE.Color(), horizon: new THREE.Color(), glow: new THREE.Color() }
const _sunOut = new THREE.Color()
const _b: SkyColors = { zenith: new THREE.Color(), mid: new THREE.Color(), horizon: new THREE.Color(), glow: new THREE.Color() }
const _c = new THREE.Color()
const _t1 = new THREE.Color()
const _t2 = new THREE.Color()

function skyAt(keys: (SkyColors & { alt: number })[], alt: number, out: SkyColors) {
  let i = 1
  while (i < keys.length - 1 && alt > keys[i].alt) i++
  const k0 = keys[i - 1]
  const k1 = keys[i]
  const t = clamp01((alt - k0.alt) / (k1.alt - k0.alt))
  out.zenith.copy(k0.zenith).lerp(k1.zenith, t)
  out.mid.copy(k0.mid).lerp(k1.mid, t)
  out.horizon.copy(k0.horizon).lerp(k1.horizon, t)
  out.glow.copy(k0.glow).lerp(k1.glow, t)
}

/** 時（0〜24）が a〜b の間（日をまたぐ範囲も可）なら 1、外なら 0。境目の前後 fade 時間でなめらかに変わる */
function window01(h: number, a: number, b: number, fade: number) {
  const m = (x: number) => ((x % 24) + 24) % 24
  const sinceStart = m(h - a + 12) - 12
  const untilEnd = m(b - h + 12) - 12
  if (Math.abs(sinceStart) < fade) return smooth(-fade, fade, sinceStart)
  if (Math.abs(untilEnd) < fade) return smooth(-fade, fade, untilEnd)
  return m(h - a) <= m(b - a) ? 1 : 0
}

/** 日付（年の中の日）が 季節の範囲に入っている度合い。[始まり, 盛り, 盛りの終わり, 終わり]（年の中の日） */
function season(dayOfYear: number, [a, b, c, d]: [number, number, number, number]) {
  if (dayOfYear < a || dayOfYear > d) return 0
  if (dayOfYear < b) return smooth(a, b, dayOfYear)
  if (dayOfYear > c) return 1 - smooth(c, d, dayOfYear)
  return 1
}

/** 時刻から外の状態を計算する（毎コマ。軽い計算だけ） */
export function updateOutdoor(): Outdoor {
  const o = outdoor
  o.version++
  labNow(o.time)
  sunPosition(o.time.utcMs, undefined, undefined, o.sun)
  const alt = o.sun.altitude
  const az = o.sun.azimuth
  directionFromAltAz(alt, az, o.sunDir)
  const h = o.time.hours

  // 空: 朝と夕方の表を、太陽の方位（東 / 西）でなめらかに切り替える。
  // 部屋に入る外の光は元の表（_raw）、外の空と町を照らす光は夕方を仕上げた表（o.zenith など）
  const evening = smooth(150, 210, az)
  o.deepNight = window01(h, 0, 3, 1.2) * (1 - smooth(-16, -11, alt))
  skyAt(MORNING, alt, _a)
  for (const [table, out] of [
    [EVENING, _raw],
    [EVENING_OUT, o],
  ] as const) {
    skyAt(table, alt, _b)
    out.zenith.copy(_a.zenith).lerp(_b.zenith, evening)
    out.mid.copy(_a.mid).lerp(_b.mid, evening)
    out.horizon.copy(_a.horizon).lerp(_b.horizon, evening)
    out.glow.copy(_a.glow).lerp(_b.glow, evening)
    // 深夜（0〜3 時ごろ）は、夜の濃紺から漆黒に近い紺へ
    if (o.deepNight > 0) {
      out.zenith.lerp(DEEP_NIGHT.zenith, o.deepNight)
      out.mid.lerp(DEEP_NIGHT.mid, o.deepNight)
      out.horizon.lerp(DEEP_NIGHT.horizon, o.deepNight)
    }
  }

  // 太陽と反対側の地平線: 朝夕（太陽の高度 ±12 度くらい）は、中ほどの空の色に少し桃色を足した青紫（地球の影の帯）
  const twilight = 1 - smooth(6, 16, Math.abs(alt + 2))
  _t2.copy(o.mid).multiplyScalar(0.95).add(_t1.setRGB(0.06, 0.03, 0.05).multiplyScalar(smooth(-8, 0, alt)))
  o.horizonAnti.copy(o.horizon).lerp(_t2, twilight * 0.85)

  o.daylight = smooth(-6, 10, alt)
  o.night = 1 - smooth(-10, -1, alt)
  const dark = 1 - smooth(-3.5, 2.5, alt)

  // 星: 宵の終わりから見え始め、深夜はさらに多い
  o.stars = (1 - smooth(-14, -6, alt)) * (0.75 + 0.25 * o.deepNight)

  // 太陽の円盤と直射の光（_c は部屋に入る光の色、_sunOut は町を照らす色）
  sunColorAt(alt, _c)
  sunColorAt(alt, _sunOut, OUT_SUN_COLORS)
  const strength = interp(SUN_STRENGTH, alt)
  o.sunDisc.copy(_sunOut).multiplyScalar(smooth(-1.4, 0.6, alt) * (14 + 26 * smooth(0, 20, alt)))
  o.sunLight.copy(_sunOut).multiplyScalar(strength * 1.55)
  // 空の光（上からの環境光）: 明るさは空の 3 段の色の平均。色は天頂と中ほどの空に寄せ、朝夕は彩度を落とす
  // （地平線の橙と中ほどの紫をそのまま足すと、日の当たらない面と地面が桃色になる。実際の夕方の日陰は青みの灰色）
  const skyLum = luminance(_t1.copy(o.zenith).add(o.mid).add(o.horizon).multiplyScalar(0.36))
  o.skyLight.copy(o.zenith).multiplyScalar(0.45).add(_t2.copy(o.mid).multiplyScalar(0.4)).add(_t1.copy(o.horizon).multiplyScalar(0.15))
  saturate(o.skyLight, 1 - 0.42 * twilight)
  o.skyLight.multiplyScalar(skyLum / Math.max(1e-5, luminance(o.skyLight)))

  // 雲: 光の当たる側は太陽の色（夕方は金に縁取られる）、影の側は空の色に寄せる
  o.cloudLit.copy(_sunOut).multiplyScalar(0.25 + 0.95 * strength).add(_t1.copy(o.horizon).multiplyScalar(0.45))
  o.cloudShade.copy(o.mid).multiplyScalar(0.55).add(_t1.copy(o.zenith).multiplyScalar(0.25))
  // 夜の雲は町の明かりで下からほんのり照らされる（暖色の灰）
  o.cloudShade.lerp(_t1.setRGB(0.05, 0.042, 0.04), o.night * 0.6)
  o.cloudLit.lerp(_t1.setRGB(0.06, 0.05, 0.045), o.night)

  // 夜の地平線の町明かり（町の方角だけ）
  o.cityGlow.setRGB(0.07, 0.045, 0.028).multiplyScalar(dark * (1 - 0.55 * o.deepNight))

  // 空気遠近: 遠くほど地平線の空の色に溶け込む（夜は澄んで遠くまで見える）
  // 昼（太陽が高い）は空気が澄んで、かすみは薄く少し青い（町が白く平らに見えないように）。朝夕は低い太陽の色のかすみ
  const highSun = smooth(12, 40, alt)
  o.haze.copy(o.horizon).multiplyScalar(0.92).lerp(_t1.copy(o.mid).multiplyScalar(0.85), 0.3 * highSun)
  o.hazeDistance = 9000 + 7000 * highSun + 7000 * o.night
  // 海: 深い青緑。昼は空の光、夕方は橙を映す（映り込みは海のシェーダーで足す）
  o.water.set('#0a2a40').multiplyScalar(0.15 + 0.85 * o.daylight)

  // 町の灯り
  const gainDark = dark
  o.lights.window = gainDark * interp(WINDOW_BY_HOUR, h)
  o.lights.office = gainDark * interp(OFFICE_BY_HOUR, h)
  o.lights.shop = gainDark * interp(SHOP_BY_HOUR, h)
  o.lights.street = gainDark * interp(STREET_BY_HOUR, h)
  o.lights.port = gainDark
  o.lights.path = gainDark
  o.lights.far = gainDark * interp(FAR_BY_HOUR, h)
  const service = window01(h, CABLE.service[0], CABLE.service[1] + CABLE.tripSeconds / 3600, 0.1)
  o.lights.cable = gainDark * (0.35 + 0.65 * service)
  o.lightGain = 0.55 + 0.45 * o.night
  o.dome = (1 - smooth(2, 8, alt)) * window01(h, 15, 24, 0.6)
  o.soranowa = (1 - smooth(-1, 2, alt)) * window01(h, 11, 22, 0.08)
  o.lighthouse = 1 - smooth(-1, 3, alt)
  o.clockFace = dark * window01(h, 4.5, 1, 0.3)
  o.cableRunning = service
  // 潮位（半日周潮。仮の位相）
  o.tide = 0.5 + 0.5 * Math.sin((o.time.utcMs / 3600_000 / 12.42) * Math.PI * 2)

  // 季節: 楓坂の紅葉（11 月中旬〜12 月上旬が盛り）と、桜（4 月の初め）
  o.autumn = season(o.time.dayOfYear, [296, 322, 340, 352])
  o.spring = season(o.time.dayOfYear, [82, 89, 96, 104])

  // 部屋に入る外の光
  const I = o.interior
  I.sun = interp(SUN_STRENGTH, alt) * 3.4
  I.sunColor.copy(_c)
  const midLum = luminance(_raw.mid)
  I.ambient = 0.22 * o.daylight
  I.ambientSky.copy(_raw.mid).lerp(_raw.horizon, 0.5).multiplyScalar(1 / Math.max(0.02, midLum))
  I.ambientGround.set('#8a7a68')
  // 反射用の環境: 夜は今までのほのかな夜景（#3a5f9a・0.38 くらい）、昼は空の明るさ
  I.envSky.copy(_raw.zenith).lerp(_raw.mid, 0.6).multiplyScalar(1.1).add(_t1.setRGB(0.03, 0.05, 0.09).multiplyScalar(1 - o.daylight))
  I.envGround.copy(_raw.horizon).multiplyScalar(0.5).add(_t2.setRGB(0.05, 0.04, 0.03).multiplyScalar(o.lights.window + 0.3 * o.lights.street))
  I.glassOpacity = 0.22 + 0.16 * o.daylight
  return o
}
