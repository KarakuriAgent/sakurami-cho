import { CABLE_STATIONS, type CableStationZone } from './cableStations'
import { DECK_H, NORIBA, SORANOWA } from './soranowa'
import { SITE } from './town'

/**
 * 中を作る名前のある建物（町の段階 4 の後半。docs/design/town.md の §13）の決まった値。
 *
 * - 「場所（ゾーン）」: ラボとそのまわり（lab）と、遠くの建物ごとのセット（thompson・seizu・cafe（Café Platform 1872）・dome（ガーデンドーム）・
 *   soranowa（大観覧車ソラノワの乗り場とホイール。乗る仕組みは character/ride/））。
 *   花音はゾーンの中だけ歩いて動き、ゾーンをまたぐときは kanon.place（撮影ではカットでつなぐ）
 * - 座標はシーンの座標（x = 東、y = 上（ラボの床 = 0）、z = 南）。建物ごとの局所の座標（u, v や s, t）から変える道具もここに置く
 * - 立ち寄り先（config/layout.ts の STOPS）と、通り道・地面の高さ（world/outdoor/interior/）が、町のデータを読む前から使う
 *
 * このファイルは layout.ts からも読むので、アプリのほかの部品を import しない（町の SITE だけ）
 */

export type Vec3 = [number, number, number]

const LAB = SITE.labFloorElevation

/** 遠くのゾーン（中のある建物。丘ノ上ケーブルの 3 駅も） */
export type InteriorZoneId = 'thompson' | 'seizu' | 'cafe' | 'dome' | 'soranowa' | CableStationZone

/**
 * ゾーン（花音が歩いて動ける範囲）の名前。town = 町の中（ラボのまわり・中のある建物のゾーンの外。kanon.travel の途中と、
 * 町の行き先（小野寺時計店の前など）。character/avatar/travel.ts）
 */
export type ZoneId = 'lab' | InteriorZoneId | 'town'

/* -------------------------------------------------------------------------- */
/* 建物の局所の座標                                                              */
/* -------------------------------------------------------------------------- */

/**
 * 建物の局所の座標の決まり（平面の原点 (ox, oy)・右へ (ax, ay)・床の標高 z）。
 * 局所の点 (s, t, h): 平面 = 原点 + a × s + b × t（b = a を左へ 90° 回した向き。t は奥へ / 北へ）、標高 = z + h
 */
export interface LocalFrame {
  ox: number
  oy: number
  ax: number
  ay: number
  /** 奥への向き（b） */
  bx: number
  by: number
  z: number
}

/** 局所の座標の決まりを作る（b = a を反時計回りに 90°） */
export function localFrame(ox: number, oy: number, ax: number, ay: number, z: number): LocalFrame {
  const l = Math.hypot(ax, ay) || 1
  const a = [ax / l, ay / l]
  return { ox, oy, ax: a[0], ay: a[1], bx: -a[1], by: a[0], z }
}

/** 局所の (s, t) → 町の平面座標 [x, y] */
export function planOf(f: LocalFrame, s: number, t: number): [number, number] {
  return [f.ox + f.ax * s + f.bx * t, f.oy + f.ay * s + f.by * t]
}

/** 局所の (s, t, h) → シーンの座標 */
export function sceneOf(f: LocalFrame, s: number, t: number, h = 0): Vec3 {
  const [x, y] = planOf(f, s, t)
  return [x, f.z + h - LAB, -y]
}

/** 局所の向き（s, t の成分）→ シーンの向き（Y 軸まわりの角度。0 = +z（南）、π/2 = +x（東）） */
export function headingOf(f: LocalFrame, ds: number, dt: number) {
  const x = f.ax * ds + f.bx * dt
  const y = f.ay * ds + f.by * dt
  return Math.atan2(x, -y)
}

/** シーンの x, z → 局所の (s, t) */
export function localOf(f: LocalFrame, x: number, z: number): [number, number] {
  const dx = x - f.ox
  const dy = -z - f.oy
  return [dx * f.ax + dy * f.ay, dx * f.bx + dy * f.by]
}

/**
 * トンプソン家（building.kaedezaka.thompson）。原点は母屋の南西の角（外形の線の上）、s = u = 東へ、t = v = 北へ。床の標高 47.75m。
 * 母屋の外形は u 0〜9.6・v 0〜7.5、北のガレージは u 3.3〜10.3・v 7.5〜11.5（データの外形のとおり）
 */
export const THOMPSON_FRAME = localFrame(-652.3, -375.6, 1, 0, 47.75)

/**
 * 星図珈琲（building.akarimachi.seizu-coffee）。原点は正面（北東の面）の右の角（外から見て左の端の点 (-686.5, -1720.3)）、
 * s = 正面に沿って外から見て右へ（北西へ）、t = 正面から奥へ（南西へ）。床の標高 8.13m。正面の幅 7.03m・奥行き 8.03m
 */
export const SEIZU_FRAME = localFrame(-686.5, -1720.3, -4.5, 5.4, 8.13)

/**
 * Café Platform 1872（building.ekimae.cafe-platform-1872。桜見駅の右翼の角）。原点は正面（北西の面）の左の端（外から見て。駅舎の側の角
 * (-696.8, -1401.3)）、s = 正面に沿って外から見て右へ（南西へ）、t = 正面から奥へ（南東へ）。床の標高 4.84m。正面の幅 16.05m・奥行き 14m。
 * 外観の型（kits/station.ts の cafePlatform）の Frame.edge と同じ s・t。テラスは正面の外（t -9.5〜-2.5）
 */
export const CAFE_FRAME = localFrame(-696.8, -1401.3, -11.3, -11.4, 4.84)

/**
 * ガーデンドーム（building.chuo.garden-dome。まるの森の中心）。原点はドームの中心 (-800, -945)、s = 東へ、t = 北へ。床の標高 7.75m（データの ground_z_m）。
 * ガラスの半球は半径 60m・高さ 48m（中心の高さは床の 0.5m 下）。南門は t = -65.5（張り出しの入口の外の面）
 */
export const DOME_FRAME = localFrame(-800, -945, 1, 0, 7.75)

/**
 * 大観覧車ソラノワの乗り場（building.shiomiko.soranowa-noriba。白い鉄骨とガラスの平屋）。原点は正面（南南西の面）の左の端（外から見て。(-2331.5, -2374.7)）、
 * s = 正面に沿って外から見て右へ（東南東へ）、t = 正面から奥へ（北北東へ。ホイールの側）。床の標高 2.5m。正面の幅 18.0m・奥行き 10.0m。
 * ホイールの中心は (s 9.14, t 23.5)、ホイールの面は s に対して約 21° 傾く（ホイールの局所の座標は core/soranowa.ts）。乗り場の台は建物の奥（北）の外
 */
export const SORANOWA_NORIBA_FRAME = localFrame(NORIBA.ox, NORIBA.oy, NORIBA.ax, NORIBA.ay, NORIBA.z)

/** 階（床の局所の高さ。中の部屋の組み立て・通り道・カメラの高さの基準） */
export interface LevelDef {
  name: string
  /** 床の高さ（建物の床からの m） */
  floor: number
  /** 天井の高さ（建物の床からの m） */
  ceiling: number
}

export interface ZoneDef {
  id: InteriorZoneId
  label: string
  buildingId: string
  frame: LocalFrame
  /** ゾーンの中心（シーンの x, z）と、ゾーンに入っているとみなす半径（m。建物と前の道） */
  center: [number, number]
  radius: number
  /** 建物の床の高さ（シーンの y） */
  floorY: number
  levels: LevelDef[]
  /** 中を作る・壊す距離（カメラか花音から建物の中心まで m） */
  loadRadius: number
  unloadRadius: number
  /**
   * ガラスの温室（ガーデンドーム）: 中は空の下と同じ光（太陽と空の光が町の影の地図ごと入る）。カメラの露出・花音の光は外と同じ扱いにし、
   * 夜だけ中の灯りで照らす（§7）
   */
  glasshouse?: boolean
  /** 配信モードのカメラの範囲の上（階の床から m。省けば 22。観覧車は乗っているゴンドラがてっぺんまで上がる） */
  cameraUp?: number
  /** 外の段の下の地面を下げる所（named/grade.ts。設計の段の数のまま、段の下の地面を段の下の高さにそろえる。§7 の 143） */
  approaches?: ApproachDef[]
  /**
   * 町の石段の「下から step 段目」に面する建物（設定の本文の段の数。§7 の 170）: 局所の点 foot（外の段の下）を石段の線に下ろした所を中心に、
   * step 段目の踏面を長さ landing m の踊り場にし、高さを建物の床から h m にする（core/walk/townStairs.ts の StairAnchor）
   */
  stairJoin?: { stairs: string; step: number; foot: [number, number]; h: number; landing: number }
  /**
   * 建物の下の地形を下げる床の標高（named/grade.ts。省けばデータの床 z。null なら下げない）。丘ノ上ケーブルの駅は、駅の床（コンコース）の高さ
   * （データの z は斜面の途中の値）。楓坂駅は上屋とホームの台だけなので下げない
   */
  groundFloor?: number | null
}

/**
 * 外の段の下の地面の均し（局所の座標）: 段の下の端の中ほど foot から外へ out の向きに、幅 width・長さ length を高さ h（建物の床からの m）の
 * 1cm 下まで下げ、その先は勾配 slope（既定 0.15）、両わきは 0.6 で元の地面へ戻す。下げるだけで上げない
 */
export interface ApproachDef {
  foot: [number, number]
  out: [number, number]
  width: number
  length: number
  h: number
  slope?: number
}

const zoneOf = (id: InteriorZoneId, label: string, buildingId: string, frame: LocalFrame, cs: number, ct: number, radius: number, levels: LevelDef[], extra: Partial<ZoneDef> = {}): ZoneDef => {
  const c = sceneOf(frame, cs, ct)
  return { id, label, buildingId, frame, center: [c[0], c[2]], radius, floorY: frame.z - LAB, levels, loadRadius: 90, unloadRadius: 150, ...extra }
}

/** 中のある建物のゾーン */
export const INTERIOR_ZONES: Record<InteriorZoneId, ZoneDef> = {
  thompson: zoneOf('thompson', 'トンプソン家', 'building.kaedezaka.thompson', THOMPSON_FRAME, 4.8, 5.5, 22, [
    // 1 階の床は玄関の土間（建物の床 = データの ground_z_m）より 0.15m 上（上がり框。§7）
    { name: '1 階', floor: 0.15, ceiling: 2.62 },
    { name: '2 階', floor: 2.9, ceiling: 5.45 },
    { name: '屋根裏', floor: 5.75, ceiling: 8.35 },
  ], {
    // ポーチの木の階段（4 段・床の 0.48m 下へ）の下から、門へ向かう庭の小道。高さ画像の地面は段の下で 0.4m ほど高い（§7 の 143）
    approaches: [{ foot: [-3.6, 8.25], out: [-1, 0], width: 1.7, length: 2.0, h: -0.48 }],
    // 家の前は百段石段の下から 68 段目（設定の本文 vol2・D-011。§7 の 170）: ポーチの木の階段の下の所を 68 段目の踊り場（長さ 2m）にし、
    // 高さはポーチの木の階段を 4 段下りた所（床の 0.48m 下）
    stairJoin: { stairs: 'stairs.hyakudan', step: 68, foot: [-3.6, 8.25], h: -0.48, landing: 2.0 },
  }),
  seizu: zoneOf('seizu', '星図珈琲', 'building.akarimachi.seizu-coffee', SEIZU_FRAME, 3.5, 1.5, 20, [{ name: '店', floor: 0, ceiling: 3.25 }]),
  // 店（高い天井。旧駅の待合室を模した内装）と、正面の外のテラス・駅前広場
  cafe: zoneOf('cafe', 'Café Platform 1872', 'building.ekimae.cafe-platform-1872', CAFE_FRAME, 8.0, 2.0, 24, [{ name: '店', floor: 0, ceiling: 6.9 }]),
  // ドーム（4 層 + 地下）。とても大きいので、中は遠くから作る（ガラス越しに外から見える）。ゾーンは南門の前の広場まで
  dome: zoneOf(
    'dome',
    'ガーデンドーム',
    'building.chuo.garden-dome',
    DOME_FRAME,
    0,
    -6,
    84,
    [
      { name: '根の階', floor: 0, ceiling: 47 },
      { name: '幹の回廊（1 層）', floor: 6.0, ceiling: 47 },
      { name: '枝の回廊（2 層）', floor: 13.0, ceiling: 47 },
      { name: '梢のテラス（3 層）', floor: 22.0, ceiling: 47 },
      { name: '種の間（地下）', floor: -4.5, ceiling: -0.6 },
    ],
    { loadRadius: 260, unloadRadius: 340, glasshouse: true },
  ),
  // 大観覧車ソラノワの乗り場（ガラスの乗り場の建物と、ゴンドラが下を通る乗り場の台）。ゾーンは乗っているゴンドラがどこにいても入るよう、
  // ホイールの全体（直径 100m）と建物の前の広場まで
  soranowa: zoneOf(
    'soranowa',
    '大観覧車ソラノワ',
    SORANOWA.buildingId,
    SORANOWA_NORIBA_FRAME,
    9,
    20,
    60,
    [
      { name: '地上', floor: 0, ceiling: 4.5 },
      // 台の高さは乗り場の地面（標高 2.51m）から。建物の床（2.5m）からの高さにする
      { name: '乗り場の台', floor: DECK_H + SORANOWA.ground - 2.5, ceiling: DECK_H + SORANOWA.ground - 2.5 + 2.9 },
    ],
    { cameraUp: 118 },
  ),
  // 丘ノ上ケーブルの 3 駅（core/cableStations.ts。駅の局所の座標は s = 線路に沿って山の側へ・t = 北西へ。中の決まりは interior/briefs/cable.ts）。
  // 頂上駅と麓駅は駅舎の中（コンコース・改札・待合室・段々のホーム）、楓坂駅は上屋の下の両側の段々のホームと構内踏切
  'cable-summit': zoneOf('cable-summit', CABLE_STATIONS['cable-summit'].label, CABLE_STATIONS['cable-summit'].buildingId, CABLE_STATIONS['cable-summit'].frame, 19, 0, 24, [{ name: '駅', floor: 0, ceiling: 4.5 }], { loadRadius: 110, unloadRadius: 170, groundFloor: CABLE_STATIONS['cable-summit'].frame.z }),
  'cable-kaedezaka': zoneOf('cable-kaedezaka', CABLE_STATIONS['cable-kaedezaka'].label, CABLE_STATIONS['cable-kaedezaka'].buildingId, CABLE_STATIONS['cable-kaedezaka'].frame, 12, 0, 16, [{ name: '駅', floor: 0, ceiling: 3.6 }], { loadRadius: 110, unloadRadius: 170, groundFloor: null }),
  'cable-fumoto': zoneOf('cable-fumoto', CABLE_STATIONS['cable-fumoto'].label, CABLE_STATIONS['cable-fumoto'].buildingId, CABLE_STATIONS['cable-fumoto'].frame, 24, 0, 26, [{ name: '駅', floor: 0, ceiling: 6.0 }], { loadRadius: 110, unloadRadius: 170, groundFloor: CABLE_STATIONS['cable-fumoto'].frame.z }),
}

export const INTERIOR_ZONE_IDS = Object.keys(INTERIOR_ZONES) as InteriorZoneId[]

/** シーンの x, z がどのゾーンか（遠くのゾーンの円の中なら、その id。どれでもなければ lab） */
export function zoneAt(x: number, z: number): 'lab' | InteriorZoneId {
  for (const id of INTERIOR_ZONE_IDS) {
    const d = INTERIOR_ZONES[id]
    if (Math.hypot(x - d.center[0], z - d.center[1]) < d.radius) return id
  }
  return 'lab'
}

/** ラボのゾーン（ラボとそのまわりのセット・小道）の広さ（ラボからの m）。これより遠く、中のある建物のゾーンでもなければ town */
export const LAB_ZONE_RADIUS = 150

/** シーンの x, z のゾーン（町の中も分ける） */
export function zoneOfPoint(x: number, z: number): ZoneId {
  const id = zoneAt(x, z)
  if (id !== 'lab') return id
  return Math.hypot(x, z) < LAB_ZONE_RADIUS ? 'lab' : 'town'
}

/** 立ち寄り先の位置（局所の座標から）。y は 0（高さは階と地面から） */
export function stopAt(f: LocalFrame, s: number, t: number): Vec3 {
  const p = sceneOf(f, s, t)
  return [p[0], 0, p[2]]
}

/** 立ち寄り先のカメラ（局所の座標から。h は階の床（外の立ち寄り先は地面）からの高さ） */
export function shotAt(f: LocalFrame, pos: [number, number, number], target: [number, number, number], fov: number) {
  const p = sceneOf(f, pos[0], pos[1])
  const q = sceneOf(f, target[0], target[1])
  return { position: [p[0], pos[2], p[2]] as Vec3, target: [q[0], target[2], q[2]] as Vec3, fov }
}

/** 町の石段の段を合わせる所（ゾーンの stairJoin を平面座標にしたもの。core/walk/townStairs.ts の StairAnchor と同じ形。townWalk.init に渡す） */
export function townStairAnchors() {
  const out: { stairs: string; step: number; x: number; y: number; z: number; landing: number }[] = []
  for (const zone of Object.values(INTERIOR_ZONES)) {
    const j = zone.stairJoin
    if (!j) continue
    const [x, y] = planOf(zone.frame, j.foot[0], j.foot[1])
    out.push({ stairs: j.stairs, step: j.step, x, y, z: zone.frame.z + j.h, landing: j.landing })
  }
  return out
}
