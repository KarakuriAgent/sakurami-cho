import { LAB_OUTLINE } from '../../../core/labPlan'
import { TOWN_PLACES } from '../../../core/places'
import { PALETTE } from '../../palette'
import {
  BASE_STATION_RING_Y,
  CEILING_LIGHTS,
  ENTRANCE,
  KB001_DOCK_TOP,
  MEZZANINE,
  PLACE,
  ROOM,
  zonePointXYZ,
  type Placement,
  type Vec3,
} from '../../../core/lab/plan'

/**
 * ラボの照明の表（データの側。docs/design/map-split.md §6 の「段 4」・4-3。案の §3.1）。前の Lighting.tsx の光の並び（31 個）と
 * labLights.ts の位置の式を、そのまま表にした物。three・React・アプリの側を読まない。
 *
 * - 部屋の照明は控えめにして、主な光源は装置・ホログラム・モニタにしている。
 * - 表の順が光の並び（three がシェーダーで光を足す順。場面の木の順）。並びを変えると最後の桁が変わるので、足す・外すは表の中で。
 * - 什器の光には置き場所の印（kit。置き場所の表 LAB_PLACEMENTS の id）を付ける。表に無い置き場所の印の付いた光は作らない（キットを外すと光も外れる）。
 * - 配信の立ち位置まわりのキー・フィル・リムは、使う側の差し込み口 'stage'（kind: 'slot'）に入る（kanon-lab の scene/stream/stageLights.ts）。
 * - 天井のスポットは 6.5m の天井（CEIL_SPOT_Y）に付いている。照らす先・明るさ・照らす範囲が天井 5m のときと同じになるよう、
 *   光源を狙う向きのまま天井まで遠ざけ、強さは距離の 2 乗・届く距離は距離に比例して上げ、角度は狭めている。
 */

/** 天井のスポットの高さ（天井の少し下のレール） */
export const CEIL_SPOT_Y = CEILING_LIGHTS.spotY

/**
 * 光の位置は、什器の置き場所（間取りのデータ lab/plan.ts の PLACE）と部屋の寸法から作る（置き場所を動かしたら光も付いていく）。
 * zp はゾーンのローカル座標（x = 右、y = 床から、z = 前。壁沿いのゾーンは z = 0 が壁の面）→ ワールド座標（lab/plan.ts の zonePointXYZ。式は同じ）
 */
export const zp = (zone: Placement, local: Vec3): Vec3 => zonePointXYZ(zone, local)
export const HOLO = PLACE.holoTable.position
/** 中二階の片側（基地局の背板の外から外の壁まで）の中心の x と幅 */
export const MEZZ_SIDE = { x: (MEZZANINE.backdropX + ROOM.halfWidth) / 2, w: ROOM.halfWidth - MEZZANINE.backdropX }

/** 天井のスポットの位置と照らす先（光の筋 lab/atmosphere.ts も同じ所に出す）。配信の立ち位置のキー・フィル・リムは使う側（stageLights） */
export const LAB_SPOTS = {
  /** ホロテーブルの上 */
  holo: [HOLO[0] + 0.56, CEIL_SPOT_Y, HOLO[2] + 0.84] as Vec3,
  /** 工作台の手元灯 */
  bench: { from: zp(PLACE.workshop, [0.12, CEIL_SPOT_Y, 1.3]), to: zp(PLACE.workshop, [0.4, 0.9, 0.6]) },
  /** 3D プリンタ */
  printer: { from: zp(PLACE.workshop, [-1.2, CEIL_SPOT_Y, 1.7]), to: zp(PLACE.workshop, [-1.2, 0.9, 0.5]) },
  /** CNC とパーツケース（北の壁沿い） */
  cnc: { from: zp(PLACE.workshopNorth, [0, CEIL_SPOT_Y, 1.6]), to: zp(PLACE.workshopNorth, [0, 0.9, 0.5]) },
  /** ロボットアーム */
  arm: { from: zp(PLACE.robotArm, [-0.33, CEIL_SPOT_Y, 1.21]), to: zp(PLACE.robotArm, [-0.05, 0.8, 0.1]) },
  /** ギャラリーの上 */
  gallery: { from: zp(PLACE.gallery, [0, CEIL_SPOT_Y, 2.11]), to: zp(PLACE.gallery, [0, 1.0, 0.7]) },
}

/** 壁の間接光（ウォールウォッシャー）の位置（西 -1・東 1 の壁と、その上の z）。階段・扉・家具の無い壁の所 */
export const WALL_WASH: [number, number][] = [
  [-1, -1.2],
  [-1, ROOM.south - 0.45],
  [1, 2.9],
  [1, ROOM.south - 0.7],
]

/**
 * 窓際の立ち寄り先の位置（地図の立ち寄り先の表 core/places.ts の TOWN_PLACES.window.position。5-1b で、照明の表に写していた数をそこから読むようにした。
 * kanon-lab の STOPS.window も同じ物を足して作る）。配列は写す
 */
export const WINDOW_STOP: Vec3 = [...TOWN_PLACES.window.position]

/* -------------------------------------------------------------------------- */
/* 光の表                                                                       */
/* -------------------------------------------------------------------------- */

interface LightCommon {
  /** この置き場所（LAB_PLACEMENTS の id）が表に無ければ作らない */
  kit?: string
  /**
   * 配信中に部屋の照明と一緒に落とす割合（明るさ = intensity × (dim + (1 - dim) × 明るさ)）。
   * 省略すると落とさない（装置の光・外の灯り）
   */
  dim?: number
}

export type LabLightSpec =
  /** 空と床からの弱い環境光 */
  | (LightCommon & { kind: 'hemi'; sky: string; ground: string; intensity: number })
  /** 基地局のコアの光（ゆっくり呼吸するように明滅し、基地局の入力 link・flash・pulse で強くなる。intensity は作った時の値） */
  | (LightCommon & { kind: 'core'; at: Vec3; color: string; intensity: number; distance: number })
  | (LightCommon & { kind: 'point'; at: Vec3; color: string; intensity: number; distance: number })
  /** 照らす先（to）付きのスポット。既定は penumbra 0.7・distance 12・影なし・影の地図 1024 */
  | (LightCommon & {
      kind: 'spot'
      at: Vec3
      to: Vec3
      color: string
      intensity: number
      angle: number
      penumbra?: number
      distance?: number
      /** 影を落とす（品質が high のときだけ） */
      castShadow?: boolean
      shadowMapSize?: number
    })
  /** 面光源（モニタの照り返しやショーケースの光など「面から出る柔らかい光」）。to の方を向く */
  | (LightCommon & { kind: 'area'; at: Vec3; to: Vec3; width: number; height: number; color: string; intensity: number })
  /** 差し込み口（使う側の光をこの並びの位置に入れる） */
  | { kind: 'slot'; name: 'stage' }

const holo = HOLO
const dock = PLACE.kb001Dock.position
const rack = PLACE.serverRack.position
const bs = PLACE.baseStation
const ws = PLACE.workshop
const dd = PLACE.devDesk
const gal = PLACE.gallery
const win = WINDOW_STOP
const staffZ = (ENTRANCE.staffDoor.z[0] + ENTRANCE.staffDoor.z[1]) / 2
/** 東西の外の面（|x|）と、南のガラスの外の額縁の外の面（z）。core/site.ts の SHELL.outerX・portalZ と同じ */
const OUTER_X = LAB_OUTLINE[2]
const PORTAL_Z = -LAB_OUTLINE[1]
/** ひらき札の中心の x（南西の角の柱の外の面。殻の shell/entrance.ts） */
const fudaX = (-OUTER_X + ENTRANCE.pier[1]) / 2
const S = LAB_SPOTS
/** 部屋の天井のスポットの、配信中に残す割合 */
const room = 0.22
/** 壁の間接光（ウォールウォッシャー）の、壁の面からの距離 */
const washX = ROOM.halfWidth - 0.28
const washTo = ROOM.halfWidth - 0.03

/** 光の表（前の Lighting.tsx の並びのまま。差し込み口 stage はキー・フィル・リムの位置） */
export const LAB_LIGHTS: readonly LabLightSpec[] = [
  { kind: 'hemi', sky: '#1c2d4d', ground: '#05070a', intensity: 0.7, dim: 0.45 },

  /* 基地局 */
  { kind: 'core', kit: 'baseStation', at: [bs.position[0], BASE_STATION_RING_Y, bs.position[2] + 0.8], color: PALETTE.comm, intensity: 9, distance: 9 },
  { kind: 'point', kit: 'baseStation', at: zp(bs, [-1.9, BASE_STATION_RING_Y, 1.0]), color: PALETTE.cyan, intensity: 4, distance: 7 },
  { kind: 'point', kit: 'baseStation', at: zp(bs, [1.9, BASE_STATION_RING_Y, 1.0]), color: PALETTE.cyan, intensity: 4, distance: 7 },

  /* 配信の立ち位置: キーライト（前上・影あり）、顔と金髪を持ち上げるフィル、輪郭を光らせるリム（後ろ）。使う側が入れる */
  { kind: 'slot', name: 'stage' },

  /* ホロテーブル */
  { kind: 'point', kit: 'holoTable', at: [holo[0], 1.45, holo[2]], color: PALETTE.cyan, intensity: 3.5, distance: 4.5 },
  { kind: 'spot', kit: 'holoTable', at: S.holo, to: [holo[0], 0.9, holo[2]], color: '#cfe3ff', intensity: 59, angle: 0.28, distance: 17, dim: room },

  /* KB-001 のドック */
  { kind: 'point', kit: 'kb001Dock', at: [dock[0], KB001_DOCK_TOP + 0.15, dock[2]], color: PALETTE.cyan, intensity: 1.2, distance: 2 },

  /* 基地局の柱を上からなめる光（フィンや継ぎ目の陰影を出す） */
  { kind: 'spot', kit: 'baseStation', at: zp(bs, [-2.5, CEIL_SPOT_Y, 2.98]), to: zp(bs, [-2.5, 1.2, 1.0]), color: '#cfe3ff', intensity: 44, angle: 0.23, penumbra: 0.6, distance: 17, dim: 0.45 },
  { kind: 'spot', kit: 'baseStation', at: zp(bs, [2.5, CEIL_SPOT_Y, 2.98]), to: zp(bs, [2.5, 1.2, 1.0]), color: '#cfe3ff', intensity: 44, angle: 0.23, penumbra: 0.6, distance: 17, dim: 0.45 },

  /* 工作ゾーン: 作業台の手元灯・3D プリンタ・CNC とパーツケース・ロボットアーム */
  { kind: 'spot', kit: 'workshop', at: S.bench.from, to: S.bench.to, color: '#e8f0ff', intensity: 137, angle: 0.41, distance: 17, castShadow: true, dim: room },
  { kind: 'spot', kit: 'workshop', at: S.printer.from, to: S.printer.to, color: '#dbe8ff', intensity: 78, angle: 0.37, distance: 17, dim: room },
  { kind: 'spot', kit: 'workshopNorth', at: S.cnc.from, to: S.cnc.to, color: '#dbe8ff', intensity: 60, angle: 0.37, distance: 17, dim: room },
  { kind: 'spot', kit: 'robotArm', at: S.arm.from, to: S.arm.to, color: '#cfe3ff', intensity: 67, angle: 0.37, distance: 17, dim: room },
  { kind: 'point', kit: 'workshop', at: zp(ws, [-0.8, 2.0, 1.7]), color: '#bcd4ff', intensity: 3, distance: 6, dim: room },

  /* 壁面の間接光（腰壁の上端に仕込んだウォールウォッシャーで、金属パネルに光のスカラップを作る） */
  ...WALL_WASH.map(
    ([sx, z]): LabLightSpec => ({ kind: 'spot', at: [sx * washX, 2.5, z], to: [sx * washTo, 0.2, z], color: '#cfe0ff', intensity: 9, angle: 0.55, penumbra: 0.9, distance: 4, dim: room }),
  ),

  /* 窓際（南のガラスの前）: 部屋の側から弱く照らす補助光（窓の外を眺める人の後ろ姿が、夜景の前で真っ暗な影にならないように） */
  { kind: 'point', at: [win[0] + 0.75, 2.5, win[2] - 1.1], color: '#cfe0ff', intensity: 1.2, distance: 4, dim: 0.5 },

  /* 南西の角: 通用口（西の壁）と角の柱を照らすスポット */
  { kind: 'spot', at: [-ROOM.halfWidth + 2.0, CEIL_SPOT_Y, staffZ + 0.5], to: [-ROOM.halfWidth + 0.05, 1.3, staffZ], color: '#e4eeff', intensity: 60, angle: 0.3, penumbra: 0.8, distance: 12, dim: room },
  /* 外: 見学エントランスの庇の下の灯りが、角の柱の外の面のひらき札を照らす（ひらき札は光らない琺瑯なので、これで見せる） */
  { kind: 'spot', at: [fudaX + 0.15, 2.72, PORTAL_Z + 0.6], to: [fudaX, 1.55, PORTAL_Z], color: '#ffe2bf', intensity: 6, angle: 0.6, penumbra: 0.8, distance: 3.5 },

  /*
   * 開発デスク: モニタ面からの照り返し（面光源）と、キーボードの上の点光源（机の上と、打鍵する人の前をモニタの色で照らす）。
   * 点光源は立ち寄り先（デスクの前）から 0.7m ほど離す（近いと VRM の MToon が白く飛ぶ）。高くするとモニタ脇の付箋が光って見えるので、
   * キーボードの少し上に置く。画面は配信中も点いているので落とさない
   */
  { kind: 'area', kit: 'devDesk', at: zp(dd, [0, 1.18, 0.55]), to: zp(dd, [0, 1.0, 3.0]), width: 2.1, height: 0.42, color: '#8ec5ff', intensity: 6 },
  { kind: 'point', kit: 'devDesk', at: zp(dd, [0, 1.12, 0.62]), color: '#8ec5ff', intensity: 1.5, distance: 2.6 },
  { kind: 'spot', kit: 'devDesk', at: zp(dd, [1.24, CEIL_SPOT_Y, 2.18]), to: zp(dd, [0, 0.75, 0.8]), color: '#dbe8ff', intensity: 67, angle: 0.38, distance: 17, dim: room },

  /* ギャラリー: 上からのスポットと、ケース列を正面から照らす面光源 */
  { kind: 'spot', kit: 'gallery', at: S.gallery.from, to: S.gallery.to, color: '#e8f0ff', intensity: 79, angle: 0.41, distance: 17, dim: room },
  { kind: 'area', kit: 'gallery', at: zp(gal, [0, 2.3, 1.3]), to: zp(gal, [0, 1.0, 0.1]), width: 3.8, height: 0.25, color: '#dcecff', intensity: 5, dim: 0.4 },

  /* 南のガラス壁の手前の床に落ちる光だまり（手前の床が真っ暗にならないように） */
  { kind: 'spot', at: [-1.06, CEIL_SPOT_Y, ROOM.south - 2.81], to: [-0.8, 0, ROOM.south - 1.9], color: '#d6e6ff', intensity: 37, angle: 0.4, penumbra: 0.9, distance: 16, dim: room },

  /* サーバラック（4 本の前） */
  { kind: 'point', kit: 'serverRack', at: [rack[0], 1.3, rack[2] + 1.25], color: PALETTE.blue, intensity: 2.5, distance: 3.2 },
]

/* -------------------------------------------------------------------------- */
/* 反射用の環境（光る板）                                                        */
/* -------------------------------------------------------------------------- */

/** 反射用の環境の強さ（scene.environmentIntensity の、明るさ 1 のときの値。前の stream/fx.ts の ENV_INTENSITY） */
export const LAB_ENV_INTENSITY = 0.85

/** 反射用の環境の撮り方（前の drei の Environment と同じ: cube 256 px・原点・near 0.1・far 1000・背景の色） */
export const LAB_ENV_CAPTURE = { resolution: 256, near: 0.1, far: 1000, background: '#010204' } as const

/**
 * 反射用の環境の光る板（前の drei の Lightformer）。form: rect = 1×1 の板、ring = 輪（内 0.25・外 0.5）、circle = 円（半径 0.5）。
 * 板は全部が原点を向く（drei の Lightformer は rotation の指定が無いと原点を向き、前の rotation-x・rotation-y の指定は効いていなかった。
 * その見え方のまま。直すかどうかは段 4 の外で画を見て決める）。
 * outdoor の板は外の光（時刻で変わる）で、色と強さは作る時と撮り直す時に外の光から決める（intensity・color は使わない）
 */
export interface LabFormerSpec {
  form: 'rect' | 'ring' | 'circle'
  at: Vec3
  /** 大きさ（数 1 つなら全部の軸） */
  scale: number | Vec3
  color: string
  intensity: number
  /** 外の光の板（sky = 空、ground = 町と地面） */
  outdoor?: 'sky' | 'ground'
  kit?: string
  /** 同じ値の板を 1 つの群にまとめる（前の JSX の <group> の入れ子。行列の掛け方を変えないため） */
  group?: number
}

/** 南のガラス壁の範囲（x） */
const glassLen = ROOM.halfWidth - 0.4 - ENTRANCE.glassFrom
const glassMid = (ROOM.halfWidth - 0.4 + ENTRANCE.glassFrom) / 2

/** 光る板の表（前の LabEnvironment の並びのまま） */
export const LAB_FORMERS: readonly LabFormerSpec[] = [
  /* 天井のライン照明 */
  ...CEILING_LIGHTS.lineXs.flatMap((x) =>
    CEILING_LIGHTS.lineZs.map((z): LabFormerSpec => ({ form: 'rect', at: [x, CEILING_LIGHTS.lineY, z], scale: [0.15, 2.4, 1], color: '#d8ecff', intensity: 2.2 })),
  ),
  /* 基地局のリング（シアン）とコア（通信のグリーン） */
  { form: 'ring', kit: 'baseStation', at: zp(PLACE.baseStation, [0, BASE_STATION_RING_Y, 0.2]), scale: 1.9, color: PALETTE.cyan, intensity: 2.5 },
  { form: 'circle', kit: 'baseStation', at: zp(PLACE.baseStation, [0, BASE_STATION_RING_Y, 0.4]), scale: 0.45, color: PALETTE.comm, intensity: 1.5 },
  /* 西と東のハイサイドの窓（外の空。時刻で変わる） */
  ...[-1, 1].map((s): LabFormerSpec => ({ form: 'rect', outdoor: 'sky', at: [s * (ROOM.halfWidth - 0.1), 3.5, ROOM.centerZ], scale: [ROOM.depth, 1.8, 1], color: '#ffffff', intensity: 1 })),
  /* 南のガラス壁（床から天井まで）: 上は空、下は町と地面（時刻で変わる）。枠のシアンのネオン */
  { form: 'rect', outdoor: 'sky', at: [glassMid, ROOM.height * 0.62, ROOM.south - 0.1], scale: [glassLen, ROOM.height * 0.76, 1], color: '#ffffff', intensity: 1 },
  { form: 'rect', outdoor: 'ground', at: [glassMid, ROOM.height * 0.12, ROOM.south - 0.1], scale: [glassLen, ROOM.height * 0.24, 1], color: '#ffffff', intensity: 1 },
  { form: 'rect', at: [glassMid, 0.05, ROOM.south - 0.15], scale: [glassLen, 0.05, 1], color: PALETTE.cyan, intensity: 3 },
  { form: 'rect', at: [glassMid, ROOM.height - 0.1, ROOM.south - 0.15], scale: [glassLen, 0.05, 1], color: PALETTE.cyan, intensity: 2.4 },
  /* 中二階（北の上の段）: 縁の光のラインと、奥のほのかな明るさ */
  ...[-1, 1].flatMap((s): LabFormerSpec[] => [
    { form: 'rect', group: s, at: [s * MEZZ_SIDE.x, MEZZANINE.floorY - 0.03, ROOM.north + 0.1], scale: [MEZZ_SIDE.w - 0.4, 0.03, 1], color: PALETTE.cyan, intensity: 2.4 },
    { form: 'rect', group: s, at: [s * MEZZ_SIDE.x, 4.6, ROOM.north - 0.2], scale: [MEZZ_SIDE.w, 3.6, 1], color: '#1b2c4a', intensity: 0.3 },
  ]),
  /* 床際の LED ライン */
  { form: 'rect', at: [0, 0.05, ROOM.north + 0.1], scale: [ROOM.width, 0.05, 1], color: PALETTE.cyan, intensity: 3 },
  ...[-1, 1].map((s): LabFormerSpec => ({ form: 'rect', at: [s * (ROOM.halfWidth - 0.1), 0.05, ROOM.centerZ], scale: [ROOM.depth, 0.05, 1], color: PALETTE.cyan, intensity: 3 })),
  /* モニタ（右）とホロテーブル（左）のほのかな光 */
  { form: 'rect', kit: 'devDesk', at: zp(PLACE.devDesk, [0, 1.2, 0.6]), scale: [2, 0.5, 1], color: '#7fb8ff', intensity: 1.2 },
  { form: 'circle', kit: 'holoTable', at: [HOLO[0], 1.1, HOLO[2]], scale: 1, color: PALETTE.cyan, intensity: 1.5 },
]
