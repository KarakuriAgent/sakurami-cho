import { LAB_HEIGHTS, LAB_OUTLINE } from './labPlan'
import { ENTRANCE, ENTRANCE_DOOR, MEZZANINE, ROOM } from './lab/plan'

/**
 * ラボの外観（外側の殻）と、その前のセット（テラス・石段・スロープ・小道・見晴らし台）の寸法。町の段階 3（docs/design/town.md の §11）。
 *
 * - 座標はシーンの座標（ラボの床の中心が原点、x = 東、y = 上、z = 南。単位 m）。町の地図データの平面座標（x = 東、y = 北）とは y = -z
 * - ラボの寸法は設定資料の間取り（labPlan.ts。D-052）のとおり。外側の殻は資料の外形（東西 17.2m × 南北 10.8m）で、中（ラボの間取りのデータ core/lab/plan.ts の ROOM・MEZZANINE・ENTRANCE）との間が壁の厚み（§7 の 132〜）
 * - 外の地面の高さは、ここで決めた面（テラス・石段・スロープ・見晴らし台）と、地形（町の高さ画像を小道に沿って均したもの。site/grade.ts）
 * - 花音の通り道（character/avatar/nav.ts）・地面の高さ（site/ground.ts）・形（site/）は、どれもこのファイルの値から作る
 */

export type XZ = readonly [number, number]

/* -------------------------------------------------------------------------- */
/* ラボの外側の殻                                                                */
/* -------------------------------------------------------------------------- */

/** 外壁の厚み（資料の外形の外の面と、メインホールの壁の内側の差。0.2m） */
const WALL = LAB_OUTLINE[2] - ROOM.halfWidth

/**
 * 外側の殻（打ち放しのコンクリート・陸屋根）。外の面は資料の外形（x = ±8.6・北 -5.4・南 +5.4）。
 * 北の部屋（中二階の下）は外形の中。南のガラス壁の外は、壁と屋根の厚みの額縁（portal）で囲む
 */
export const SHELL = {
  /** 外壁の厚み（中の金属パネルの裏から外の面まで） */
  wall: WALL,
  /** 東西の外の面（|x|） */
  outerX: LAB_OUTLINE[2],
  /** 北の部屋の奥の壁の中の面（z）と外の面 */
  northInner: ROOM.north - MEZZANINE.depth,
  northOuter: -LAB_OUTLINE[3],
  /** 南のガラスの面（z）と、ガラスの外の額縁（東西の壁の端と屋根の縁）の外の面 */
  glassZ: ROOM.south,
  portalZ: -LAB_OUTLINE[1],
  /** 基礎の見え始め（地面の下まで伸ばす）・床・天井・屋根の上面・パラペットの上端（資料の軒 7.3m） */
  plinthBottom: -2.6,
  ceiling: ROOM.height,
  roofTop: ROOM.height + 0.4,
  parapetTop: LAB_HEIGHTS.parapet,
  /** 東西のハイサイドの窓（中の殻 world/lab/shell/room.ts の sideWall と同じ高さ） */
  clerestory: [2.6, 4.4] as XZ,
  /** 見学エントランスと通用口（中の ENTRANCE と同じ） */
  entrance: ENTRANCE,
} as const

/**
 * 見学エントランスのガラスの扉の中心（x）と開口の幅、自動の開き戸の開き始める距離・開く時間・閉じる時間・開いたときの角度。
 * 値はラボの間取りのデータ（core/lab/plan.ts の ENTRANCE_DOOR）にあり、ここは町の敷地の側の名前として再び出すだけ（段 4 の 4-4）。
 * このファイルは kanon-lab の設定（config/layout）を読まず、ラボの間取りのデータだけを読む（段 5 の 5-1a）。地図の core へ移っても、
 * DOOR は地図の中の別名として残す（docs/design/map-split.md §7「5-1a で作った形」）
 */
export const DOOR = ENTRANCE_DOOR

/* -------------------------------------------------------------------------- */
/* ラボの前のセット                                                               */
/* -------------------------------------------------------------------------- */

/**
 * 南のテラス（ガラス壁の前。打ち放しの土間と同じ高さで、扉の外は段差なし）。南の縁は擁壁と手すり、
 * 見学エントランスの正面に下の小道への石段、東の端から東へ下るスロープ。西は建物の西の面より 1.5m 外まで出て、
 * 通用口の前の踊り場（WEST_LANDING）とつながる
 */
export const TERRACE = {
  x0: -SHELL.outerX - 1.5,
  x1: SHELL.outerX,
  z0: SHELL.glassZ,
  z1: 9.05,
  /** 上面の高さ（床の 2cm 下） */
  y: -0.02,
  /** 縁の手すりの高さ */
  railHeight: 1.05,
}

/**
 * 通用口（西の面の南端）の前の踊り場。テラスと同じ高さで、南でテラスにつながる。西と北の縁は擁壁と手すり
 */
export const WEST_LANDING = {
  x0: TERRACE.x0,
  x1: -SHELL.outerX,
  z0: 3.0,
  z1: SHELL.portalZ,
  y: TERRACE.y,
}

/** テラスから下の小道へ下る石段（見学エントランスの正面から南へ） */
export const ENTRY_STAIR = {
  x0: -8.1,
  x1: -4.9,
  /** 上の段の縁（テラスの南の縁） */
  z0: TERRACE.z1,
  risers: 8,
  rise: 0.17,
  tread: 0.34,
  /** 両側の袖壁の厚み */
  cheek: 0.25,
}
/** 石段の下の端（z）と高さ */
export const STAIR_BOTTOM = {
  z: ENTRY_STAIR.z0 + ENTRY_STAIR.risers * ENTRY_STAIR.tread,
  y: TERRACE.y - ENTRY_STAIR.risers * ENTRY_STAIR.rise,
}

/** テラスの東の端から東へ下るスロープ（大パラボラと見晴らし台への道へ） */
export const RAMP = {
  x0: SHELL.outerX,
  x1: 21.6,
  z0: 5.95,
  z1: 8.65,
  y0: TERRACE.y,
  y1: -1.24,
  /** 両側の袖壁の厚み */
  cheek: 0.22,
}

/**
 * ひらき見晴らし台（地図データの plaza.miharashidai の北の平らな所。標高 110.0m の石畳の円い台。
 * 南の縁は石積みの擁壁と手すりで、下は町へ下る斜面）
 */
export const LOOKOUT = {
  center: [66, 44.5] as XZ,
  radius: 11.5,
  /** 上面の高さ（標高 110.0m） */
  y: -6.0,
  /** 南の縁（擁壁と手すり）の範囲（中心から見た向き。rad、0 = 南（+z）、+ は東へ回る） */
  parapetArc: [-1.75, 1.75] as XZ,
}

/** 大パラボラ（地図データの structure.sakuragioka.parabola の中心。シーンの x, z）と、まわりの木を除く半径 */
export const PARABOLA = { center: [35, -5] as XZ, clear: 10.5 }

/** 大パラボラの前の砂利の広場（.003 の小道から分かれる短い小道の先） */
export const PARABOLA_PAD = {
  center: [24.4, -1.7] as XZ,
  radius: 2.6,
}

export type SurfaceKind = 'stone' | 'slab' | 'gravel' | 'asphalt' | 'cobble'

export interface SitePath {
  id: string
  /** 中心線（シーンの x, z） */
  pts: XZ[]
  width: number
  surface: SurfaceKind
  /** 縁石を付けるか */
  curb: boolean
  /** 街灯の間隔（m。0 なら置かない） */
  lamps: number
}

/**
 * ラボのまわりで作り直した小道（地図データの道の代わり・つなぎ）。シーンの座標。
 * - lab-front: 地図の「ラボの前の小径」（y = -9。アプリのテラスと重なる）を、テラスの擁壁の下（z ≒ 13）へ移した
 * - ramp-link: スロープの下から .004（見晴らし台への小径）へ
 * - parabola-spur: .003 から大パラボラの前の広場へ
 */
export const SITE_PATHS: SitePath[] = [
  {
    id: 'lab-front',
    pts: [
      [-12.4, 13.05],
      [-8.6, 13.25],
      [-6.5, 13.35],
      [2.0, 13.15],
      [9.0, 12.65],
      [15.0, 11.85],
    ],
    width: 3.0,
    surface: 'slab',
    curb: true,
    lamps: 13,
  },
  {
    id: 'ramp-link',
    pts: [
      [RAMP.x1, (RAMP.z0 + RAMP.z1) / 2],
      [23.6, 8.65],
      [25.6, 12.9],
    ],
    width: 2.4,
    surface: 'slab',
    curb: true,
    lamps: 0,
  },
  {
    id: 'parabola-spur',
    pts: [
      [19.7, -0.84],
      [21.6, -1.35],
      [PARABOLA_PAD.center[0] - 1.2, PARABOLA_PAD.center[1]],
    ],
    width: 1.6,
    surface: 'gravel',
    curb: false,
    lamps: 0,
  },
]

/**
 * 地図データの道の付け替え（id → head: 始めの点をこの点の列に置き換える・end: 終わりの点・extend: 終わりに足す点・drop: 使わない。シーンの座標）。
 * 地図の道のつなぎ目（x = 10, y = -9）はアプリのテラスの東の端に当たるので、作り直した小道の端へ移す
 */
export const PATH_REROUTE: Record<string, { head?: XZ[]; end?: XZ; drop?: boolean; extend?: XZ[] }> = {
  'road.hill.lab-front': { drop: true },
  'road.hill.003': { head: [[RAMP.x1 + 0.9, 7.05], [22.5, 4.2]] },
  'road.hill.004': { head: [[15.0, 11.85]], extend: [[58.6, 36.6]] },
}

/** 地図データの道のうち、形（縁石つきの舗装）で作る範囲（ラボからの距離 m）。その先は地面の色のまま */
export const PATH_MESH_RADIUS = 280

/** 小道の種類ごとの見た目（地図データの surface・class から） */
export function surfaceOf(surface: string | null, cls: string | null): SurfaceKind {
  const s = surface ?? ''
  if (s.includes('砂利') || s.includes('土')) return 'gravel'
  if (s.includes('アスファルト') || cls === 'local' || cls === 'alley') return 'asphalt'
  if (s.includes('石畳')) return 'cobble'
  return 'slab'
}

/* -------------------------------------------------------------------------- */
/* 外の小物                                                                      */
/* -------------------------------------------------------------------------- */

/** テラスのベンチ（打ち放しの台に木の座面。南を向く） */
export const TERRACE_BENCHES: { x: number; z: number; length: number; yaw: number }[] = [{ x: 5.6, z: 6.4, length: 2.4, yaw: 0 }]

/** テラスの植え込みの箱（低い打ち放しの箱。窓から町を見る線より低い） */
export const TERRACE_PLANTERS: { x0: number; x1: number; z0: number; z1: number }[] = [
  // 窓際のカメラ（南西を向く）の画に入らない、テラスの東寄りの手すり際と、西の端の壁際（スロープの口はふさがない）
  { x0: 5.1, x1: 6.9, z0: 8.25, z1: 8.77 },
  { x0: -8.45, x1: -8.0, z0: 6.4, z1: 7.4 },
]

/** 見晴らし台のベンチ（中心からの向き rad・距離 m）と、硬貨式の望遠鏡（向き） */
export const LOOKOUT_BENCHES: { angle: number; dist: number }[] = [
  { angle: -0.95, dist: 8.6 },
  { angle: 0.95, dist: 8.6 },
]
export const LOOKOUT_SCOPE = { angle: 0.32, dist: 10.6 }

/** 道しるべ（行き先の札の柱）。シーンの x, z と、札の向き（rad） */
export const SIGNPOSTS: { x: number; z: number; yaw: number; lines: string[] }[] = [
  { x: -2.4, z: 14.0, yaw: 0, lines: ['← 頂上駅・千年桜広場', '見晴らし台・大パラボラ →'] },
  { x: 57.0, z: 34.6, yaw: -0.8, lines: ['ひらき見晴らし台', 'HIRAKI LOOKOUT 110m'] },
]

/* -------------------------------------------------------------------------- */
/* 花音の通り道（外）                                                            */
/* -------------------------------------------------------------------------- */

/**
 * 外の通り道の点（シーンの x, z）。立ち寄り先と、小道の折れ線（細かくした点）と合わせて、見通しのきく点どうしを結ぶ（character/avatar/nav.ts）。
 * 扉の内と外の点は、ガラスの扉の中心の線の上に置く（扉を通る経路がここを通る）
 */
const LOOKOUT_CENTER = LOOKOUT.center
export const OUTDOOR_NAV_POINTS: XZ[] = [
  [DOOR.x, ROOM.south - 0.6], // 扉の中
  [DOOR.x, SHELL.portalZ + 0.7], // 扉の外（テラス）
  [-1.2, 7.45], // テラスの中ほど
  [4.4, 7.8], // テラスの東寄り
  // スロープの上・途中・下（3.2m ごと）
  ...Array.from({ length: Math.floor((RAMP.x1 - 9.05) / 3.2) + 1 }, (_, i): XZ => [9.05 + i * 3.2, 7.3]),
  [RAMP.x1 + 0.2, 7.3],
  [-6.5, TERRACE.z1 - 0.45], // 石段の上
  [-6.5, STAIR_BOTTOM.z + 0.45], // 石段の下
  // 見晴らし台（小道の来る北西の口・台の中ほど・南の縁の手前）
  [LOOKOUT_CENTER[0] - 6.6, LOOKOUT_CENTER[1] - 6.9],
  [LOOKOUT_CENTER[0] - 3.3, LOOKOUT_CENTER[1] - 3.5],
  [LOOKOUT_CENTER[0], LOOKOUT_CENTER[1]],
  [LOOKOUT_CENTER[0], LOOKOUT_CENTER[1] + 4.8],
]

/** 外の歩ける所の形（通り道の判定）。rect = x/z の範囲、disc = 円（中心・半径）。小道は SITE_PATHS と地図の道の折れ線から足す */
export type WalkArea = { kind: 'rect'; min: XZ; max: XZ } | { kind: 'disc'; center: XZ; radius: number }

export const WALK_AREAS: WalkArea[] = [
  // 扉を通る所（扉の枠の内側。花音の体の余白を引いて扉の中心から ±0.5m）
  { kind: 'rect', min: [DOOR.x - 0.82, ROOM.south - 1.2], max: [DOOR.x + 0.82, SHELL.portalZ + 0.9] },
  // テラス（ガラス壁と西の壁の額縁より前）
  { kind: 'rect', min: [TERRACE.x0 + 0.1, SHELL.portalZ + 0.05], max: [TERRACE.x1, TERRACE.z1 - 0.1] },
  // 通用口の前の踊り場（テラスにつながる）
  { kind: 'rect', min: [WEST_LANDING.x0 + 0.1, WEST_LANDING.z0 + 0.1], max: [WEST_LANDING.x1, SHELL.portalZ + 0.1] },
  { kind: 'rect', min: [ENTRANCE.glassFrom, SHELL.glassZ + 0.05], max: [TERRACE.x1 - 0.85, TERRACE.z1 - 0.1] },
  // 石段（テラスに 1m 重ねる。重ならないと、つなぎ目で縁からの余白が足りずに通れない）
  { kind: 'rect', min: [ENTRY_STAIR.x0 + ENTRY_STAIR.cheek, TERRACE.z1 - 1.0], max: [ENTRY_STAIR.x1 - ENTRY_STAIR.cheek, STAIR_BOTTOM.z + 1.4] },
  // スロープ（テラスに 1.2m 重ねる）
  { kind: 'rect', min: [RAMP.x0 - 1.2, RAMP.z0 + RAMP.cheek], max: [RAMP.x1 + 1.0, RAMP.z1 - RAMP.cheek] },
  // 見晴らし台・大パラボラの前
  { kind: 'disc', center: LOOKOUT.center, radius: LOOKOUT.radius - 0.7 },
  { kind: 'disc', center: PARABOLA_PAD.center, radius: PARABOLA_PAD.radius },
]

/** 外の障害物（ベンチ・植え込みの箱・望遠鏡・街灯の柱は site/ground.ts が足す）。x/z の範囲 */
export const OUTDOOR_OBSTACLES: { min: XZ; max: XZ; height: number; name: string }[] = [
  ...TERRACE_BENCHES.map((b) => ({ min: [b.x - b.length / 2, b.z - 0.3] as XZ, max: [b.x + b.length / 2, b.z + 0.3] as XZ, height: 0.45, name: 'テラスのベンチ' })),
  ...TERRACE_PLANTERS.map((p) => ({ min: [p.x0, p.z0] as XZ, max: [p.x1, p.z1] as XZ, height: 0.45, name: 'テラスの植え込み' })),
]

/**
 * 外にいるとき（体の高さ・カメラ・光の切り替え）の判定に使う、ラボの中の範囲（メインホールと北の部屋。扉の所はガラスの面まで）
 */
export function insideLab(x: number, z: number, margin = 0) {
  return Math.abs(x) < ROOM.halfWidth + margin && z < ROOM.south + margin && z > SHELL.northInner - margin
}
