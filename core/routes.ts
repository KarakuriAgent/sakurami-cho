/**
 * 花音の道順 A〜G（設定資料 vol2 第4章「花音の歩くルート」。町の地図データの check の道順の計算 D-005・D-037 と、
 * out/check/report.json の routes）。kanon.travel の route=A..G が使う（character/avatar/travel.ts）。
 *
 * 道順は「道順の点（WAYPOINTS）」をつなぐ区間（leg）の列。区間の種類:
 * - walk: 歩く（町の道のグラフの上でいちばん早い道。core/walk/townNav.ts。ケーブルの辺は使わない）
 * - underground: 駅自由通路（地下）を歩く。地下は作っていないので、見えない区間（cut。町の時刻をその分進める）
 * - cable: 丘ノ上ケーブル（駅の入口から乗って、着いた駅の入口の外まで。character/ride/cableRide.ts）
 * - tram: 緑電（line 系統。停留所のホームで待って乗り、着いた停留所のホームから降りる。character/ride/tramRide.ts）
 *
 * ref は町の地図データの道順の計算（report.json の routes）の値（試験: tools/check-walk.mjs が ±5% で比べる）。
 * 区間の点は D-037 のとおり（家 = 百段石段の下から 68 段目、ラボ = 見学エントランス（南西の角）の前、噴水広場 = 広場の縁のどこか、
 * 南口 = 駅舎正面の中央、星図珈琲 = 星見石段の上、小野寺時計店 = 時計坂の中ほど）。
 *
 * 座標は町の平面座標（m。x = 東、y = 北）。このファイルは bun（tools/check-walk.mjs）からも読むので、ほかのファイルを import しない。
 */

/** 道順の点: 平面座標の点（いちばん近い道へつなぐ）・ケーブルの駅（駅前の道の節点）・広場（縁の節点のどれか） */
export type WaypointDef = { label: string; at: [number, number]; tramStop?: string } | { label: string; station: string } | { label: string; plaza: string }

export const WAYPOINTS = {
  house: { label: 'トンプソン家の前（百段石段の 68 段目）', at: [-655.7, -363.6] },
  hyakudanTop: { label: '百段石段の上', at: [-649.6, -346.9] },
  kaedezaka: { label: '丘ノ上ケーブル 楓坂駅', station: 'station.cable-kaedezaka' },
  summit: { label: '丘ノ上ケーブル 頂上駅', station: 'station.cable-summit' },
  fumoto: { label: '丘ノ上ケーブル 麓駅', station: 'station.cable-fumoto' },
  lab: { label: '桜木丘ラボの見学エントランスの前', at: [-10.0, -9.0] },
  fountain: { label: '噴水広場', plaza: 'plaza.funsui' },
  south: { label: '桜見駅 南口（駅舎正面）', at: [-671.0, -1372.0] },
  north: { label: '桜見駅 北口', at: [-692.7, -1513.1] },
  inariCorner: { label: '灯町稲荷の角', at: [-650.0, -1680.0] },
  seizu: { label: '星見石段の上（星図珈琲）', at: [-688.0, -1717.0] },
  cafe: { label: 'Café Platform 1872 の前', at: [-709.9, -1410.9] },
  sakashita: { label: '楓坂の坂下（楓坂一丁目）', at: [-1030.0, -645.0] },
  kitamon: { label: 'まるの森の北門', at: [-800.0, -674.5] },
  sakaue: { label: 'つづら道の下（楓坂五丁目）', at: [-579.3, -148.7] },
  domeNorth: { label: 'ガーデンドームの北門の前', at: [-800.0, -870.0] },
  tokeiTop: { label: '時計坂の上', at: [-671.2, -1750.6] },
  onodera: { label: '小野寺時計店の前（時計坂の中ほど）', at: [-650.6, -1861.0] },
  marunomoriEast: { label: '緑電 まるの森東 停留所', at: [-529.5, -946.8], tramStop: 'まるの森東' },
  hirakiDori: { label: '緑電 ひらき通り 停留所', at: [796.8, -1425.1], tramStop: 'ひらき通り' },
} as const satisfies Record<string, WaypointDef>

export type WaypointId = keyof typeof WAYPOINTS

export type LegMode = 'walk' | 'underground' | 'cable' | 'tram' | 'waterbus' | 'hover'

export interface LegDef {
  /** 設定資料の手順の番号（A-2 など） */
  id: string
  label: string
  from: WaypointId
  to: WaypointId
  mode: LegMode
  /** cable・tram の時間（分。乗り降りを含む） */
  minutes?: number
  /** tram の系統の番号 */
  line?: number
  /** 町の地図データの道順の計算の値（分・m）。試験で ±5% で比べる */
  ref?: { minutes: number; length: number }
}

/** 道順の両端（ゾーンか、町の行き先 TRAVEL_PLACES） */
export type RouteEnd = 'lab' | 'thompson' | 'seizu' | 'cafe' | 'dome' | 'onodera' | 'hiraki'

export interface TravelRouteDef {
  id: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'
  label: string
  from: RouteEnd
  to: RouteEnd
  /** 設定資料の時間（分。花音の足で寄り道なし） */
  bookMinutes: number
  legs: LegDef[]
  /** ゾーンへ入る口（ガーデンドームは北門。省けばゾーンの決まった口） */
  portal?: string
}

/** ケーブルの時間（分。全線 4 分の比例 + 乗り降り 0.5 分ずつ。D-037） */
const CABLE_KS = 3.0
const CABLE_SF = 5.0

export const TRAVEL_ROUTES: Record<TravelRouteDef['id'], TravelRouteDef> = {
  A: {
    id: 'A',
    label: '家 → 桜木丘ラボ（毎日の出勤）',
    from: 'thompson',
    to: 'lab',
    bookMinutes: 12,
    legs: [
      { id: 'A-2', label: '百段石段を上る', from: 'house', to: 'hyakudanTop', mode: 'walk', ref: { minutes: 0.59, length: 17.9 } },
      { id: 'A-3', label: '等高線沿いの道を東へ、楓坂駅へ', from: 'hyakudanTop', to: 'kaedezaka', mode: 'walk', ref: { minutes: 1.92, length: 151.6 } },
      { id: 'A-5', label: '丘ノ上ケーブルで頂上駅へ', from: 'kaedezaka', to: 'summit', mode: 'cable', minutes: CABLE_KS, ref: { minutes: 3.0, length: 0 } },
      { id: 'A-6', label: '天文台の擁壁沿いの小径を東へ、ラボへ', from: 'summit', to: 'lab', mode: 'walk', ref: { minutes: 4.21, length: 264.9 } },
    ],
  },
  B: {
    id: 'B',
    label: '桜木丘ラボ → 星図珈琲',
    from: 'lab',
    to: 'seizu',
    bookMinutes: 25,
    // 星見石段を上った入口の前から入る（石段の下の出入口は route=auto 用。core/travel.ts）
    portal: 'main',
    legs: [
      { id: 'B-1', label: 'ラボから頂上駅へ', from: 'lab', to: 'summit', mode: 'walk', ref: { minutes: 4.16, length: 264.9 } },
      { id: 'B-2', label: '丘ノ上ケーブルで麓駅へ', from: 'summit', to: 'fumoto', mode: 'cable', minutes: CABLE_SF, ref: { minutes: 5.0, length: 0 } },
      { id: 'B-3', label: '森の小径を南へ、ドームの東を回って噴水広場へ', from: 'fumoto', to: 'fountain', mode: 'walk', ref: { minutes: 5.71, length: 475.8 } },
      { id: 'B-4', label: '緑樹大通りを南東へ、駅の南口へ', from: 'fountain', to: 'south', mode: 'walk', ref: { minutes: 4.76, length: 385.0 } },
      { id: 'B-5', label: '駅自由通路（地下）で北口へ', from: 'south', to: 'north', mode: 'underground', ref: { minutes: 1.95, length: 156.2 } },
      { id: 'B-6', label: '提灯小路を灯町稲荷の角へ', from: 'north', to: 'inariCorner', mode: 'walk', ref: { minutes: 2.13, length: 172.7 } },
      { id: 'B-7', label: '星見横丁から星見石段を上る', from: 'inariCorner', to: 'seizu', mode: 'walk', ref: { minutes: 1.05, length: 53.1 } },
    ],
  },
  C: {
    id: 'C',
    label: '家 → Café Platform 1872（待ち合わせ）',
    from: 'thompson',
    to: 'cafe',
    bookMinutes: 22,
    legs: [
      { id: 'C-1', label: '百段石段を下り、楓坂を坂下まで', from: 'house', to: 'sakashita', mode: 'walk', ref: { minutes: 8.01, length: 626.3 } },
      { id: 'C-4', label: '桜木丘のふもとの道を東へ、まるの森の北門へ', from: 'sakashita', to: 'kitamon', mode: 'walk', ref: { minutes: 3.2, length: 261.6 } },
      { id: 'C-5a', label: 'まるの森の小径を噴水広場へ', from: 'kitamon', to: 'fountain', mode: 'walk', ref: { minutes: 5.3, length: 444.2 } },
      { id: 'C-5b', label: '緑樹大通りを南口へ', from: 'fountain', to: 'south', mode: 'walk', ref: { minutes: 4.76, length: 385.0 } },
      { id: 'C-6', label: '南口から Café Platform 1872 へ', from: 'south', to: 'cafe', mode: 'walk', ref: { minutes: 0.69, length: 54.9 } },
    ],
  },
  D: {
    id: 'D',
    label: '桜木丘ラボ → ガーデンドーム（保守の仕事）',
    from: 'lab',
    to: 'dome',
    bookMinutes: 15,
    portal: 'north',
    legs: [
      { id: 'D-1a', label: 'ラボから頂上駅へ', from: 'lab', to: 'summit', mode: 'walk', ref: { minutes: 4.16, length: 264.9 } },
      { id: 'D-1b', label: '丘ノ上ケーブルで麓駅へ', from: 'summit', to: 'fumoto', mode: 'cable', minutes: CABLE_SF, ref: { minutes: 5.0, length: 0 } },
      { id: 'D-1c', label: '麓駅からまるの森の北門へ', from: 'fumoto', to: 'kitamon', mode: 'walk', ref: { minutes: 0.41, length: 31.6 } },
      { id: 'D-2', label: '森の小径をドームの北門へ', from: 'kitamon', to: 'domeNorth', mode: 'walk', ref: { minutes: 5.97, length: 489.7 } },
    ],
  },
  E: {
    id: 'E',
    label: '家 → 小野寺時計店（祖父母の店）',
    from: 'thompson',
    to: 'onodera',
    bookMinutes: 27,
    legs: [
      { id: 'E-1', label: '楓坂を下ってまるの森を抜け、駅の南口へ', from: 'house', to: 'south', mode: 'walk', ref: { minutes: 20.21, length: 1629.0 } },
      { id: 'E-2a', label: '駅自由通路（地下）で北口へ', from: 'south', to: 'north', mode: 'underground', ref: { minutes: 1.95, length: 156.2 } },
      { id: 'E-2', label: 'ガード沿いの道を南東へ（ジャンク堂・はんだ屋ゴローの前）、時計坂の上へ', from: 'north', to: 'tokeiTop', mode: 'walk', ref: { minutes: 3.9, length: 295.1 } },
      { id: 'E-3', label: '時計坂を下って小野寺時計店へ', from: 'tokeiTop', to: 'onodera', mode: 'walk', ref: { minutes: 1.29, length: 112.0 } },
    ],
  },
  F: {
    id: 'F',
    label: '桜木丘ラボ → 学園地区（受託の仕事）',
    from: 'lab',
    to: 'hiraki',
    bookMinutes: 22,
    legs: [
      { id: 'F-1a', label: 'ラボから頂上駅へ', from: 'lab', to: 'summit', mode: 'walk', ref: { minutes: 4.16, length: 264.9 } },
      { id: 'F-1b', label: '丘ノ上ケーブルで麓駅へ', from: 'summit', to: 'fumoto', mode: 'cable', minutes: CABLE_SF, ref: { minutes: 5.0, length: 0 } },
      { id: 'F-1c', label: '麓駅からまるの森の外周の円環道へ', from: 'fumoto', to: 'kitamon', mode: 'walk', ref: { minutes: 0.41, length: 31.6 } },
      { id: 'F-2a', label: '円環道を東へ、まるの森東の停留所へ', from: 'kitamon', to: 'marunomoriEast', mode: 'walk' },
      // 本文は「乗って約7分」（データの停留所の時刻は まるの森東 3 分 → ひらき通り 9 分）
      { id: 'F-2b', label: '緑電 4 系統「学園線」でひらき通りへ', from: 'marunomoriEast', to: 'hirakiDori', mode: 'tram', minutes: 7, line: 4 },
    ],
  },
  G: {
    id: 'G',
    label: '深夜の帰り道（桜木丘ラボ → 家。つづら道）',
    from: 'lab',
    to: 'thompson',
    bookMinutes: 20,
    legs: [
      { id: 'G-1', label: 'ラボの前からつづら道を下り、楓坂五丁目へ', from: 'lab', to: 'sakaue', mode: 'walk', ref: { minutes: 16.25, length: 1350.8 } },
      { id: 'G-2', label: '楓坂を下り、百段石段を下って家へ', from: 'sakaue', to: 'house', mode: 'walk', ref: { minutes: 5.9, length: 405.8 } },
    ],
  },
}

export const TRAVEL_ROUTE_IDS = Object.keys(TRAVEL_ROUTES) as TravelRouteDef['id'][]
