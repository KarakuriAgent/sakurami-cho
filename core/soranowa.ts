import { SITE } from './town'

/**
 * 大観覧車ソラノワ（汐見港地区 帆柱町3番。vol2 3-9）の決まった値と、ホイール・ゴンドラの位置の計算（花音が乗る。docs/design/town.md §17）。
 *
 * - 値は町の地図データの構造物 `structure.shiomiko.soranowa`（直径 100m・地上 107.5m・ゴンドラ 60 基・ホイールの面の向き）と同じ。
 *   町のデータを読む前から、立ち寄り先（config/layout.ts）・ゾーン（core/interiors.ts）・乗る仕組み（character/ride/）が使うので、ここに写す
 *   （town/soranowa.ts が読んだデータと食い違えば、コンソールに注意を出す）
 * - 座標は 2 つ（乗り場の建物の中と前は、ほかの中のある建物と同じく建物の局所の座標 s, t。core/interiors.ts の SORANOWA_NORIBA_FRAME）:
 *   - ホイールの局所（wheel）: 原点 = ホイールの中心の真下の地面（標高 2.51m）、x = ホイールの面に沿って（平面図の帯の向き）、y = 上、z = 軸の向き
 *     （+z がラボの丘の側、−z が乗り場の建物の側）。town/soranowa.ts の group の局所の座標と同じ（group は位置 (x, 標高 - 116, -y)・回転 y = axis）
 *   - ゴンドラの局所（cabin）: 原点 = ゴンドラを吊る軸（外周の外 0.7m）、向きはホイールの局所と同じ（ゴンドラはいつも水平）。扉は −z の面（乗り場の側）
 *
 * このファイルは町の SITE だけを読む（core/interiors.ts・layout.ts からも読む）
 */

const LAB = SITE.labFloorElevation

export const SORANOWA = {
  structureId: 'structure.shiomiko.soranowa',
  buildingId: 'building.shiomiko.soranowa-noriba',
  /** ホイールの中心の平面座標（町の x = 東、y = 北）・地面の標高・ホイールの面の向き（town/soranowa.ts の group.rotation.y） */
  x: -2315.5,
  y: -2355.2,
  ground: 2.51,
  axis: 2.4610714289225806,
  /** 地上の高さ・ホイールの直径・ゴンドラの数 */
  height: 107.5,
  diameter: 99.98700086744134,
  gondolas: 60,
  /** ゴンドラを吊る軸の、外の弦材からの距離（m） */
  pivot: 0.7,
  /** 一周の秒・営業時間（時） */
  periodSec: 900,
  openHour: 11,
  closeHour: 22,
} as const

/** ホイールの半径・軸（ハブ）の高さ・ゴンドラを吊る軸の半径（m） */
export const WHEEL_R = SORANOWA.diameter / 2
export const HUB_Y = SORANOWA.height - WHEEL_R - 2
export const PIVOT_R = WHEEL_R + SORANOWA.pivot
/** ホイールの回る速さ（rad/s。角度は時間とともに減る = 一番下ではゴンドラが −x へ動く） */
export const WHEEL_OMEGA = (Math.PI * 2) / SORANOWA.periodSec

/**
 * ゴンドラの形（ゴンドラの局所。外形は幅 2.7・奥行き 2.5・高さ 2.85m の角を落とした箱）。
 * floor = 中の床の高さ、ceiling = 中の天井、wall = 壁の内の面（x・z の半分）
 */
export const CABIN = {
  halfW: 1.35,
  halfD: 1.25,
  bottom: -3.6,
  top: -0.75,
  floor: -3.48,
  ceiling: -1.0,
  innerW: 1.21,
  innerD: 1.11,
  /** 腰（窓の下の白い壁）と窓の帯の上の高さ（外形の bottom から） */
  waist: 0.95,
  /** 扉（-z の面の真ん中）の幅・高さ（床から） */
  doorW: 0.84,
  doorH: 1.98,
  /** 長いす（x の両端。奥行き 0.44m・座面の高さ 0.42m） */
  benchX: 0.77,
  benchH: 0.42,
} as const

/** 乗り場の台の高さ（地面から m）= 一番下に来たゴンドラの中の床の高さ */
export const DECK_H = HUB_Y - PIVOT_R + CABIN.floor

/**
 * 乗り場の建物（building.shiomiko.soranowa-noriba）の局所の座標の決まり（core/interiors.ts の SORANOWA_NORIBA_FRAME）。
 * 原点は正面（南南西の面）の左の端（外から見て）、s = 正面に沿って右へ、t = 奥へ（ホイールの側）。床の標高 2.5m
 */
export const NORIBA = { ox: -2331.5, oy: -2374.7, ax: 17.1, ay: -5.6, z: 2.5, W: 18.0, D: 9.96 } as const

/**
 * 乗り場の台まわりの決まった寸法（ホイールの局所の x, z。高さは地面から）。台は一番下に来たゴンドラの扉の側（−z）、
 * 台の外の縁（建物の側）から階段（乗る人。改札から）とスロープ（降りた人。建物の東を通って正面の広場へ）が下りる
 */
export const PLATFORM = {
  /** 乗り場の台（z0 = 建物の側の縁、z1 = ゴンドラの側の縁） */
  deck: { x0: -8.0, x1: 7.0, z0: -4.6, z1: -1.4 },
  /** ゴンドラが下を通る溝（台と向かいの通路の間） */
  pit: { x0: -8.4, x1: 7.4, halfZ: 1.4 },
  /** 向かいの係員の通路（+z の側。花音は歩かない） */
  service: { x0: -5.5, x1: 5.5, z0: 1.4, z1: 2.3 },
  /** 階段（台の縁から −z へ下りる。踏み面 0.3m・8 段） */
  stairs: { x0: -6.4, x1: -4.0, risers: 8, run: 0.3 },
  /** スロープ（台の縁から −z へ 16.5m で下りる。8%） */
  ramp: { x0: 4.8, x1: 6.3, len: 16.5 },
  /** 台の屋根（ガラスの屋根。高さは台から 2.85m） */
  canopy: { x0: -8.4, x1: 7.4, z0: -5.0, z1: -1.55, rise: 2.85 },
  /** 建物の裏口（改札を出た所）の x */
  backDoorX: -5.2,
} as const

/* -------------------------------------------------------------------------- */
/* 座標                                                                         */
/* -------------------------------------------------------------------------- */

type V3 = [number, number, number]
const ca = Math.cos(SORANOWA.axis)
const sa = Math.sin(SORANOWA.axis)
/** ホイールの局所の原点（シーン） */
export const WHEEL_ORIGIN: V3 = [SORANOWA.x, SORANOWA.ground - LAB, -SORANOWA.y]

/** ホイールの局所 → シーン（y 軸まわりに axis だけ回して原点へ） */
export function wheelToScene(x: number, y: number, z: number, out: V3 = [0, 0, 0]): V3 {
  out[0] = WHEEL_ORIGIN[0] + ca * x + sa * z
  out[1] = WHEEL_ORIGIN[1] + y
  out[2] = WHEEL_ORIGIN[2] - sa * x + ca * z
  return out
}

/** シーン → ホイールの局所 */
export function sceneToWheel(x: number, y: number, z: number, out: V3 = [0, 0, 0]): V3 {
  const dx = x - WHEEL_ORIGIN[0]
  const dz = z - WHEEL_ORIGIN[2]
  out[0] = ca * dx - sa * dz
  out[1] = y - WHEEL_ORIGIN[1]
  out[2] = sa * dx + ca * dz
  return out
}

const nl = Math.hypot(NORIBA.ax, NORIBA.ay)
const na = [NORIBA.ax / nl, NORIBA.ay / nl]
/** ホイールの局所の x, z → 乗り場の建物の局所の s, t */
export function wheelToNoriba(x: number, z: number): [number, number] {
  const p = wheelToScene(x, 0, z)
  const dx = p[0] - NORIBA.ox
  const dy = -p[2] - NORIBA.oy
  return [dx * na[0] + dy * na[1], -dx * na[1] + dy * na[0]]
}

/** 乗り場の建物の局所の s, t → ホイールの局所の x, z */
export function noribaToWheel(s: number, t: number): [number, number] {
  const x = NORIBA.ox + na[0] * s - na[1] * t
  const y = NORIBA.oy + na[1] * s + na[0] * t
  const w = sceneToWheel(x, 0, -y)
  return [w[0], w[2]]
}

/** ホイールの局所の向き（x, z）→ シーンの向き（heading。0 = +z、π/2 = +x） */
export function wheelHeading(dx: number, dz: number) {
  return Math.atan2(ca * dx + sa * dz, -sa * dx + ca * dz)
}

/** シーンの向き（heading）→ ホイールの局所の向き [x, z] */
export function headingToWheel(h: number): [number, number] {
  const x = Math.sin(h)
  const z = Math.cos(h)
  return [ca * x - sa * z, sa * x + ca * z]
}

/* -------------------------------------------------------------------------- */
/* 回り方                                                                       */
/* -------------------------------------------------------------------------- */

/** 営業時間の中か（その日の 0 時からの秒） */
export function soranowaOpen(sec: number) {
  const h = (((sec % 86400) + 86400) % 86400) / 3600
  return h >= SORANOWA.openHour && h < SORANOWA.closeHour
}

/** 営業時間だけ回るときのホイールの角度（11:00 に 0。15 分で一周。営業時間の外は最後の角度で止まる） */
export function baseWheelAngle(sec: number) {
  const open = SORANOWA.openHour * 3600
  const close = SORANOWA.closeHour * 3600
  const tt = Math.min(Math.max(sec, open), close)
  return (-(tt - open) / SORANOWA.periodSec) * Math.PI * 2
}

/** ゴンドラ i の角度（ホイールの局所の xy 平面。−π/2 が一番下） */
export function gondolaAngle(i: number, wheelAngle: number) {
  return (i / SORANOWA.gondolas) * Math.PI * 2 + wheelAngle
}

/** ゴンドラを吊る軸の位置（ホイールの局所） */
export function pivotWheel(i: number, wheelAngle: number, out: V3 = [0, 0, 0]): V3 {
  const a = gondolaAngle(i, wheelAngle)
  out[0] = Math.cos(a) * PIVOT_R
  out[1] = HUB_Y + Math.sin(a) * PIVOT_R
  out[2] = 0
  return out
}

const TAU = Math.PI * 2
const wrap0 = (a: number) => ((a % TAU) + TAU) % TAU

/**
 * ゴンドラ i が一番下（乗り場）から進んだ角度（度。0〜360。進む向きが +。180 = てっぺん）。
 * 一番下の手前（乗り場へ近づいている間）は 360 に近い
 */
export function rideDegrees(i: number, wheelAngle: number) {
  // 角度は時間とともに減るので、一番下（−π/2）からの減った分
  return (wrap0(-Math.PI / 2 - gondolaAngle(i, wheelAngle)) * 180) / Math.PI
}

/** 一番下の手前で、いちばん早く乗り場に来るゴンドラ（一番下まで進む角度がいちばん小さい。rad）と、その残りの角度 */
export function nextGondolaAt(wheelAngle: number, aheadDeg = 0): { index: number; remain: number } {
  let best = 0
  let remain = Infinity
  for (let i = 0; i < SORANOWA.gondolas; i++) {
    // 一番下までの残り（rad。0 〜 2π）
    const r = wrap0(gondolaAngle(i, wheelAngle) + Math.PI / 2 - (aheadDeg * Math.PI) / 180)
    if (r < remain) {
      remain = r
      best = i
    }
  }
  return { index: best, remain }
}

/* -------------------------------------------------------------------------- */
/* 乗り降りの決まった位置（ゴンドラの局所・ゾーンの局所）                                */
/* -------------------------------------------------------------------------- */

/**
 * 乗り降り（docs/design/town.md §7 の 116〜）。座標はホイールの局所（x はホイールの面に沿って、z は −z が乗り場の台の側）:
 * - 一番下ではゴンドラ（扉の中心）が −x へ 0.354m/s で動く（x ≒ −PIVOT_R × 一番下から進んだ角度）
 * - 乗る: 花音は乗車位置（x = boardX）で待つ。ゴンドラが x = boardOpenX に来たら扉が開き、x = boardStepX に来たら歩いて乗り込み、
 *   花音と KB-001 が中に入ったら扉を閉める
 * - 降りる: ゴンドラが x = exitOpenX に来たら扉が開き、立って降車位置（exitX）へ歩いて出る
 */
export const RIDE_SPOTS = {
  /** 乗車位置（台の上。扉の前の黄色い枠）。花音はここで −z の向き（ゴンドラの通る所）を見て待つ */
  boardX: -0.35,
  boardZ: -2.05,
  /** 乗るとき: 扉が開く・歩き出すゴンドラの x */
  boardOpenX: 1.55,
  boardStepX: 0.35,
  /** 降りるとき: 扉が開くゴンドラの x と、降車位置（花音が立って歩いて出る所） */
  exitOpenX: 2.75,
  exitX: 3.05,
  exitZ: -2.35,
} as const

/** ゴンドラ（吊る軸）の x から、一番下から進んだ角度（度。一番下の手前は負） */
export function degreesAtX(x: number) {
  return (-Math.asin(Math.max(-1, Math.min(1, x / PIVOT_R))) * 180) / Math.PI
}

/** ゴンドラの中の決まった位置（ゴンドラの局所。y は中の床から） */
export const CABIN_SPOTS = {
  /** 扉の外（台の上）・扉の中（敷居の内）。花音が乗り降りで通る点 */
  doorOut: [0, 0, -CABIN.halfD - 0.62] as V3,
  doorIn: [0, 0, -CABIN.innerD + 0.32] as V3,
  /** 花音が座る前に立つ所（+x の長いすの前。−x を向いて腰を下ろす）と、座面の中心までのずれ（後ろへ。seat.shift は負） */
  stand: [0.47, 0, 0.12] as V3,
  seat: { height: CABIN.benchH, shift: -0.5 },
  /** 一緒に乗る仲間（KB-001）が浮かぶ所（−x の長いすの上。花音の向かい。character/ride/party.ts） */
  member: [-0.86, 0.74, 0.18] as V3,
  /** 天井の灯り */
  lamp: [0, CABIN.ceiling - CABIN.floor - 0.06, 0] as V3,
} as const
