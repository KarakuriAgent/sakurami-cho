import { circleOf, LAB_ENTRANCES, LAB_HEIGHTS, planToScene, rectOf } from '../labPlan'

/**
 * ラボの間取り（データの側。docs/design/map-split.md §6 の「段 4」・4-1）。部屋の寸法・中二階・北の扉・見学エントランス・天井の照明の位置・
 * 什器の置き場所（PLACE）と、殻の障害物。寸法と配置は設定資料の間取り（core/labPlan.ts。D-052 の rooms）から作る。
 *
 * three・React・アプリの側に依存しない（読み込みの時と Bun のテストからも読める。5-8 で地図のパッケージの core/lab へ移した）。
 * 置き場所の表は placements.ts、名前のある位置（アンカー）は anchors.ts、什器ごとの寸法・アンカー・障害物は kits/<種類>.plan.ts。
 * kanon-lab の config/layout.ts は、ここの値を再び出して、配信の立ち位置（stage）などの意味づけを足す。
 *
 * - 単位はメートル。Y 軸が上、原点は建物の外形の中心（= 1 階の床の中心。町の地図データの原点と同じ）。
 * - 方角（設定資料の間取りに合わせる）: 北 = -z（基地局のある奥の壁）、南 = +z（床から天井までのガラス壁）、
 *   西 = -x（工作ゾーン）、東 = +x（開発デスク・ギャラリー）。町の平面座標 (x, y) はシーンの (x, 0, -y)。
 * - メインホールは東西 16.8m × 南北 7.54m（x = ±8.4、北の壁 z = -2.34、南のガラス壁 z = +5.2）。原点に対して南北は対称ではない
 *   （奥行きの中心は ROOM.centerZ）。天井は 6.5m。
 * - 北の壁の奥（z = -5.2〜-2.34）は北側の部屋の列で、その上は中二階（MEZZANINE）。南西の角に見学エントランス、西の壁の南端に通用口（ENTRANCE）。
 * - 各什器は「自分のローカル座標」で作られていて、ここで決めた position / rotationY で部屋に置かれる。Blender で作った glTF に差し替えるときも、
 *   原点・向きの約束（下記）を守ればこのファイルの値をそのまま使える。
 * - 数は今の値と最後の桁まで同じに保つ（手で書いた数を式に置き換えない。式も変えない。§6 の 4-1）。
 *
 * 壁沿いの什器のローカル座標の約束:
 *   ローカル z = 0 が壁の内側の面、ローカル +z が部屋の内側、ローカル +x が壁に向かって右。
 */

export type Vec3 = [number, number, number]

export interface Placement {
  /** 什器の原点のワールド座標 */
  position: Vec3
  /** Y 軸まわりの回転（ラジアン） */
  rotationY: number
}

/**
 * 障害物（歩く人の通り道とカメラが避ける家具）。rect は x/z の範囲、circle は中心と半径、height は高さ（m）。
 * navOnly は歩く人の通り道だけが避ける範囲（床の線の内側など。カメラは通ってよく、見通しもさえぎらない）。
 * キットの障害物はワールドの数のまま出す（資料の長方形の値。キットのローカルから回して出すと最後の桁がずれるため。キットを動かしても付いてこない）
 */
export type Obstacle =
  | { kind: 'rect'; min: [number, number]; max: [number, number]; height: number; name: string; navOnly?: boolean }
  | { kind: 'circle'; center: [number, number]; radius: number; height: number; name: string; navOnly?: boolean }

/** キットの名前のある位置（データの側。アンカーの名前は「置き場所の id.ここの名前」） */
export interface LabAnchorPlan {
  /** ワールドの位置（今の数が出る式で） */
  p: Vec3
  /** 向き（Y 軸まわり。ワールド）。省けば置き場所の向き */
  yaw?: number
  /** 画面の前などの大きさ（m） */
  size?: { w: number; h: number }
  /**
   * 置き場所（キットの群）の中のローカルの位置と向き。あれば、物を付けるときは置き場所と同じ位置・向きの群の子にして、この位置と向きで置く
   * （ワールドの位置と向きの群に置くと、行列が什器の中に置いたときと最後の桁で一致しない。4-0 の DevTaskSign）
   */
  local?: { p: Vec3; yaw: number }
}

/** キットの純データの側（three の物を作らない。読み込みの時・Bun のテストからも呼べる） */
export interface LabKitPlan {
  /** 名前のある位置（置き場所の原点は、ここに書かなくても置き場所の id の名前で引ける） */
  anchors: Record<string, LabAnchorPlan>
  /** 歩く人とカメラが避ける形（ワールド） */
  obstacles: Obstacle[]
}

/** キットの plan（置き場所と、キットの opts から、アンカーと障害物を出す。opts を省けばキットの既定） */
export type LabKitPlanFn<O extends object = object> = (at: Placement, opts?: O) => LabKitPlan

/**
 * 置き場所のローカル座標 → ワールド座標（x = 右、y = 床から、z = 前。壁沿いの什器は z = 0 が壁の面）。
 * world/places.ts の zonePoint・lighting/lightTable.ts の zp と同じ式（式を変えると最後の桁が変わる）
 */
export function zonePointXYZ(zone: Placement, local: Vec3): Vec3 {
  const [x, y, z] = local
  const c = Math.cos(zone.rotationY)
  const s = Math.sin(zone.rotationY)
  return [zone.position[0] + x * c + z * s, zone.position[1] + y, zone.position[2] - x * s + z * c]
}

/** 置き場所のローカルの位置と向き（Y 軸まわり）で決めるアンカー（ワールドの位置は zonePointXYZ、向きは置き場所の向き＋ローカルの向き） */
export function localAnchor(at: Placement, p: Vec3, yaw = 0): LabAnchorPlan {
  return { p: zonePointXYZ(at, p), yaw: at.rotationY + yaw, local: { p, yaw } }
}

const HALL = rectOf('メインホール')
const MEZZ = rectOf('中二階')

/**
 * 部屋（メインホール）の寸法（資料のメインホールの壁の内側）。天井の高さは設定どおり 6.5m。
 * 北の壁（north）と南のガラス壁（south）は原点に対して対称ではないので、奥行きの中心は centerZ
 */
export const ROOM = {
  width: HALL.max[0] - HALL.min[0],
  depth: HALL.max[1] - HALL.min[1],
  height: LAB_HEIGHTS.ceiling,
  halfWidth: HALL.max[0],
  /** 北の壁の面（z）。その奥が北側の部屋（上は中二階） */
  north: HALL.min[1],
  /** 南のガラス壁の面（z） */
  south: HALL.max[1],
  /** 奥行きの中心（z） */
  centerZ: (HALL.min[1] + HALL.max[1]) / 2,
} as const

/** メインホールの中か（x, z。margin だけ広げる。負なら内側へ狭める） */
export function insideHall(x: number, z: number, margin = 0) {
  return Math.abs(x) < ROOM.halfWidth + margin && z > ROOM.north - margin && z < ROOM.south + margin
}

/** 壁のパネルの厚み（壁の面から部屋の側へ。殻の shell/room.ts の壁のパネル。壁沿いの什器はこの前に置く） */
export const WALL_PANEL_DEPTH = 0.035

/**
 * 天井の照明の位置。ライン照明（殻の shell/room.ts の ceiling。反射用の環境の Lightformer も同じ位置）は天井から吊り、
 * スポット（lighting/lightTable.ts）は天井の少し下のレールに付ける
 */
export const CEILING_LIGHTS = {
  /** ライン照明の高さ・並び（x の列 × z の行） */
  lineY: ROOM.height - 0.55,
  lineXs: [-3.9, -0.9, 0.9, 3.9] as number[],
  lineZs: [-0.6, 1.6, 3.8] as number[],
  /** スポットの高さ */
  spotY: ROOM.height - 0.5,
} as const

/**
 * 中二階（北の壁の線より奥、北側の部屋の上。資料: 内法 16.8m × 2.86m、床は 1 階の床から 3.0m）。
 * 全幅にあるが、中央（|x| < backdropX）は基地局の背の暗い背板（床から天井まで）に隠れ、ホールに向かって開いているのは左右
 * （縁にガラスの手すりと光のライン）。西の端に 1 階からの急な鉄骨の階段（stair。資料の「中二階への階段」）。
 * 西側に仮眠用のソファベッドとひらきボードの額、東側に資料庫の棚。
 */
export const MEZZANINE = {
  /** 床の上面の高さ */
  floorY: 3.0,
  /** 床板（下の部屋の天井）の厚み。下の面が 1 階の扉の上の壁の上端になる */
  slab: 0.3,
  /** 北の壁の線（z = ROOM.north）からの奥行き */
  depth: MEZZ.max[1] - MEZZ.min[1],
  /** 基地局の背の暗い背板の半幅（XW-08 の基壇の半幅。中二階の手すりはこの外側） */
  backdropX: 2.4,
  /** 階段（x・z の範囲。上の端は北の壁の線で、中二階の床へ上がる） */
  stair: rectOf('中二階への階段'),
} as const

/**
 * 北の壁の下の段の、北側の部屋への扉（西から。設定資料の間取りの順）。x は扉の中心（各部屋の範囲の中）、width は扉の幅。
 * 給湯室と WC は、x 2.9 の扉 1 枚の前室から奥で分かれる（資料は 2 部屋。扉は 1 枚に読み替えた。docs/design/town.md §7 の 135）。
 * 基地局（背板）の左に電源室・冷却機械室、右に給湯室・WC と、北壁沿いのサーバラックの東に資料庫
 */
export const NORTH_DOORS = [
  { name: '電源室', en: 'POWER / UPS', x: rectOf('電源室').max[0] - 0.65, width: 0.84 },
  { name: '冷却機械室', en: 'COOLING', x: rectOf('冷却機械室').min[0] + 0.45, width: 0.84 },
  { name: '給湯室・WC', en: 'PANTRY / WC', x: rectOf('給湯室').max[0] - 0.1, width: 0.84 },
  { name: '資料庫', en: 'ARCHIVE', x: rectOf('資料庫').max[0] - 1.05, width: 0.84 },
] as const

/** 扉の高さ */
export const NORTH_DOOR_HEIGHT = 2.1

const PUBLIC_DOOR = planToScene(LAB_ENTRANCES.public.at)
const STAFF_DOOR = planToScene(LAB_ENTRANCES.service.at)

/**
 * 南西の角の見学エントランス（資料: 南の面の西端、南西の角から 1.6m の扉）と、西の壁の南端の通用口（資料: 西向き。花音がふだん出入りする扉）。
 * 南の面は西の角から 角の柱（pier。ひらき札はこの柱の外の面）→ ガラスの両開きの扉（見学エントランス）→ 東の角の柱まで床から天井までのガラス壁
 */
export const ENTRANCE = {
  /** 南西の角の柱（x の範囲。ひらき札は外の面に掛ける） */
  pier: [-ROOM.halfWidth, PUBLIC_DOOR[0] - 0.8] as [number, number],
  /** ガラスの両開きの扉（x の範囲。資料の入口の点が中心、幅 1.6m） */
  glassDoor: [PUBLIC_DOOR[0] - 0.8, PUBLIC_DOOR[0] + 0.8] as [number, number],
  /** ガラスの扉の高さ（上は欄間のガラス） */
  doorHeight: 2.4,
  /** 通用口（西の壁。z の範囲。資料の入口の点が中心、幅 0.84m） */
  staffDoor: { wall: 'west' as const, z: [STAFF_DOOR[1] - 0.42, STAFF_DOOR[1] + 0.42] as [number, number] },
  /** 通用口の高さ */
  staffDoorHeight: 2.1,
  /** ガラス壁の西の端（ここから東の角の柱までガラス。見学エントランスの扉もガラス壁の中） */
  glassFrom: PUBLIC_DOOR[0] - 0.8,
  /** ガラス壁の横の桟（欄間）の高さ */
  transoms: [2.5, 4.6] as number[],
} as const

/**
 * 見学エントランスのガラスの扉（自動の開き戸。外開きの両開き）。x は扉の中心、width は開口の幅（ENTRANCE.glassDoor から）。
 * 花音か扉を開ける物（KB-001 など）が扉の前に来ると開く（殻の shell/entranceDoor.ts が進める）。
 * 町の敷地のデータ core/site.ts（5-8 で地図の core へ移した）の DOOR は、この値の別名（4-4。前は core/site.ts にあった。5-1a で別名として残すと決めた）
 */
export const ENTRANCE_DOOR = {
  x: (ENTRANCE.glassDoor[0] + ENTRANCE.glassDoor[1]) / 2,
  width: ENTRANCE.glassDoor[1] - ENTRANCE.glassDoor[0],
  /** 自動の開き戸（外開き）が開き始める、花音・KB-001 との距離（m） */
  sensor: 2.0,
  /** 開くのにかかる時間・閉じるのにかかる時間（秒） */
  openSeconds: 1.1,
  closeSeconds: 1.6,
  /** 開いたときの扉の角度（rad。外へ） */
  openAngle: 1.45,
} as const

/** 殻（中二階）の障害物。中二階への急な階段（花音は上らない） */
const STAIR = rectOf('中二階への階段')
export const SHELL_OBSTACLES: Obstacle[] = [{ kind: 'rect', name: '中二階への階段', min: STAIR.min, max: STAIR.max, height: MEZZANINE.floorY }]

/* -------------------------------------------------------------------------- */
/* 什器の置き場所                                                                */
/* -------------------------------------------------------------------------- */

/** 西の壁（x = -8.4）沿いに置くとき、ローカル +z が部屋の内側（ワールド +x）を向く回転 */
const FACE_FROM_LEFT_WALL = Math.PI / 2
/** 東の壁（x = +8.4）沿いに置くとき、ローカル +z が部屋の内側（ワールド -x）を向く回転 */
const FACE_FROM_RIGHT_WALL = -Math.PI / 2

const HOLO_TABLE = circleOf('ホロテーブル')
const DOCK = circleOf('KB-001 のドック')
const XW08 = rectOf('XW-08 本体（基壇）')
const RACK = rectOf('サーバーラック')
const GALLERY = rectOf('KB-001 試作機ギャラリー')
const DESK = rectOf('開発デスク')

/**
 * 什器の置き場所（置き場所の表 placements.ts の at）。kanon-lab の config/layout.ts の LAYOUT は、これに配信の立ち位置（stage）を足した物
 */
export const PLACE = {
  /** リンク基地局（資料の XW-08 本体。ラボの主役）。原点は北の壁の面・床の高さ・中央（基壇はローカル z 0.3〜1.9） */
  baseStation: { position: [(XW08.min[0] + XW08.max[0]) / 2, 0, ROOM.north], rotationY: 0 },

  /** ホロテーブル（資料: 直径 1.2m・ホール中央手前）。原点はテーブルの中心・床の高さ */
  holoTable: { position: [HOLO_TABLE.center[0], 0, HOLO_TABLE.center[1]], rotationY: 0 },

  /** 工作ゾーンの西の壁沿い（作業台・有孔ボード・3D プリンタ）。原点は壁の面の上、ローカル x = 0.4 が作業台の中心 */
  workshop: { position: [-ROOM.halfWidth, 0, 1.9], rotationY: FACE_FROM_LEFT_WALL },

  /** 工作ゾーンの北の壁沿い（CNC・パーツケース。階段と電源室の扉の間）。原点は北の壁の面の上 */
  workshopNorth: { position: [-6.4, 0, ROOM.north], rotationY: 0 },

  /** 工作ゾーンの床の中ほどのロボットアーム（作業範囲の印は半径 1.1m）。原点は作業範囲の中心、ローカル +z（東）に治具の台 */
  robotArm: { position: [-5.1, 0, 0.7], rotationY: Math.PI / 2 },

  /**
   * 開発デスク（資料: 東寄りの窓際の L 字のデスク。x 3.6〜7.2・z 3.0〜4.7）。原点は南の縁（窓の側）の中央で、ローカル +z が北（部屋の内側）。
   * 長辺（モニタの並ぶ机）は南の縁に沿い、東の端から北へ短辺が出る
   */
  devDesk: { position: [(DESK.min[0] + DESK.max[0]) / 2, 0, DESK.max[1]], rotationY: Math.PI },

  /** サーバラック 3 本（資料: からくりラック 2 本＋図面棚サーバー 1。北の壁沿いの東）。原点は北の壁の面の上・3 本の中央、+Z を向く */
  serverRack: { position: [(RACK.min[0] + RACK.max[0]) / 2, 0, ROOM.north], rotationY: 0 },

  /** 試作機ギャラリー（資料: 東の壁沿い、ガラスケース 3 基）。原点は壁の面の上、展示の中央 */
  gallery: { position: [ROOM.halfWidth, 0, (GALLERY.min[1] + GALLERY.max[1]) / 2], rotationY: FACE_FROM_RIGHT_WALL },

  /** KB-001 のドック（資料: ギャラリーの横・開発デスクの近く、半径 0.45m）。原点はドック台座の床の中心。ローカル +z が立ち寄り先（西南西）を向く */
  kb001Dock: { position: [DOCK.center[0], 0, DOCK.center[1]], rotationY: -1.96 },
} as const satisfies Record<string, Placement>

/** 窓際の観葉植物 4 鉢（資料: 窓際に観葉植物 4 鉢）。鉢の中心の x と z（置き場所の表の windowPlants の opts） */
export const WINDOW_PLANTS = { xs: [-2.9, -1.4, 0.4, 2.9], z: 4.8 } as const

/**
 * 基地局のリング（とコア）の中心の高さ。資料どおり 基壇 0.25m ＋ 外径 3.2m の半分（リングの上端は資料の高さ 3.45m）。
 * 配信の立ち位置をリングの軸から東へずらして、配信メインのカメラでコアが頭に重ならないようにしている（config/layout.ts の LAYOUT.stage）
 */
export const BASE_STATION_RING_Y = 1.85
/** 基地局のリング面の、北の壁からの距離（基壇の奥行きの中ほど） */
export const BASE_STATION_RING_Z = 1.1

/** KB-001 のドック台座の天面の高さ */
export const KB001_DOCK_TOP = 1.05
/** ドックの上で KB-001 が浮かぶ中心の高さ（台座天面からの距離） */
export const KB001_HOVER = 0.38
