import type { PlanXY } from './town'

/**
 * 桜木丘ラボの間取り（設定資料をそのまま写したもの。正の資料）。
 *
 * 出典: 町の地図データ（setting-book/town）の DECISIONS.md の D-052「桜木丘ラボ（外形・原点・入口・ゾーン配置）」と、
 * data/buildings.geojson の id 'building.sakuragioka.lab' の properties（rooms・entrances・外形）。
 * 第2巻 vol2_sakurami_guide.md の「3-3. 桜木丘ラボ」の間取り図・各ゾーンの説明。
 *
 * - 座標は町の平面座標のまま（原点 = 外形の中心 = 1 階の床の中心、x = 東、y = 北。m）。シーンの座標へは planToScene（x, z = −y）
 * - 長方形の部屋・ゾーンは [西, 南, 東, 北]（x0, y0, x1, y1）。資料の多角形の 4 隅のとおり
 * - 円（ホロテーブル・KB-001 のドック）は中心と半径（資料は 16〜24 角形の多角形）
 * - アプリの寸法と配置（config/layout.ts の ROOM・LAYOUT・OBSTACLES・NORTH_DOORS、core/site.ts の SHELL・ENTRANCE）は、ここから作る。
 *   資料から読み替えた所は docs/design/town.md の §7（132〜）
 * - 開発用に ?plan=1 で、この間取りの線を床に重ねて描く（src/dev/PlanOverlay.tsx）
 */

export type PlanRect = readonly [number, number, number, number]

export interface PlanRoom {
  name: string
  /** 1 = 1 階、'M' = 中二階 */
  floor: 1 | 'M'
  /** 長方形（[西, 南, 東, 北]） */
  rect?: PlanRect
  /** 円（中心と半径） */
  circle?: { center: PlanXY; radius: number }
  /** 資料の高さ（m）。あれば */
  height?: number
  note?: string
}

/** 外形（壁の外の面）。東西 17.2m × 南北 10.8m、壁は東西南北にそろう */
export const LAB_OUTLINE: PlanRect = [-8.6, -5.4, 8.6, 5.4]

/** 1 階の床の標高（m）・メインホールの天井の高さ・軒（パラペット）・屋上の物を入れた高さ */
export const LAB_HEIGHTS = { floorZ: 116.0, ceiling: 6.5, parapet: 7.3, roofItems: 8.4 } as const

/** 入口（資料の entrances）。bearing は外へ向く方位（北から時計回りの度） */
export const LAB_ENTRANCES = {
  /** 見学エントランス（南の面の西端。南西の角から 1.6m、南向き）。扉の横に若葉色の琺瑯の「ひらき札」（第二種） */
  public: { at: [-7.0, -5.4] as PlanXY, bearing: 180 },
  /** 通用口（見学エントランスの横の、西の面の南端。西向き）。花音がふだん出入りする扉（vol2 4章A） */
  service: { at: [-8.6, -4.0] as PlanXY, bearing: 270 },
} as const

/** 部屋・ゾーン（資料の rooms。順も資料のとおり） */
export const LAB_ROOMS: readonly PlanRoom[] = [
  { name: '電源室', floor: 1, rect: [-8.4, 2.34, -4.4, 5.2], note: '北側の西端。無停電電源装置（UPS）三重' },
  { name: '冷却機械室', floor: 1, rect: [-4.4, 2.34, 0.0, 5.2], note: 'Qコアとサーバーの冷却装置' },
  { name: '給湯室', floor: 1, rect: [0.0, 2.34, 3.0, 5.2], note: '電気ケトル・コーヒードリッパー・ドームはちみつ・カヌレの箱' },
  { name: 'WC', floor: 1, rect: [3.0, 2.34, 5.0, 5.2] },
  { name: '資料庫', floor: 1, rect: [5.0, 2.34, 8.4, 5.2], note: '北側の東端。中二階にも資料棚' },
  { name: 'メインホール', floor: 1, rect: [-8.4, -5.2, 8.4, 2.34], height: 6.5, note: '床は黒い樹脂塗装・防振床' },
  { name: '工作ゾーン', floor: 1, rect: [-8.4, -4.4, -3.2, 2.14], note: '西側（入口から奥を見て左手）。床に黄色の破線の危険線' },
  { name: 'XW-08 本体（基壇）', floor: 1, rect: [-2.4, 0.44, 2.4, 2.04], height: 3.45, note: '基壇 幅 4.8 × 奥行 1.6 × 高さ 0.25m。リング外径 3.2m は南を向く' },
  { name: 'サーバータワー カストル', floor: 1, rect: [-2.4, 0.74, -1.6, 1.74], height: 2.6, note: 'リングの左（西）' },
  { name: 'サーバータワー ポルックス', floor: 1, rect: [1.6, 0.74, 2.4, 1.74], height: 2.6, note: 'リングの右（東）' },
  { name: '危険線（黄色の破線）', floor: 1, rect: [-3.9, -1.06, 3.9, 2.14], note: 'リングの外周から 1.5m' },
  { name: 'ホロテーブル', floor: 1, circle: { center: [0.0, -2.46], radius: 0.6 }, note: '直径 1.2m' },
  { name: 'サーバーラック', floor: 1, rect: [3.4, 1.44, 6.4, 2.24], note: 'からくりラック 2 本＋図面棚サーバー 1（vol6）' },
  { name: 'KB-001 試作機ギャラリー', floor: 1, rect: [7.5, -1.6, 8.4, 1.4], note: 'ガラスケース 3 基（KB-α・β・γ）' },
  { name: 'KB-001 のドック', floor: 1, circle: { center: [6.6, -2.4], radius: 0.45 } },
  { name: '開発デスク', floor: 1, rect: [3.6, -4.7, 7.2, -3.0], note: 'L 字のデスク。マルチモニタ 4 面＋空中ディスプレイ 1（vol6）' },
  { name: '窓際（観葉植物 4 鉢）', floor: 1, rect: [-3.2, -5.2, 3.2, -4.4], note: '見学ルートの最後に夜景を見る所' },
  { name: '中二階への階段', floor: 1, rect: [-8.4, -0.26, -7.4, 2.34] },
  { name: '中二階', floor: 'M', rect: [-8.4, 2.34, 8.4, 5.2], note: '床は 1 階の床から 3.0m。仮眠用のソファベッド・資料棚・ひらきボードの額' },
]

/** 名前で部屋・ゾーンを引く（無ければ例外。名前は資料のとおり） */
export function planRoom(name: string): PlanRoom {
  const r = LAB_ROOMS.find((room) => room.name === name)
  if (!r) throw new Error(`labPlan: 部屋が無い（${name}）`)
  return r
}

/** 町の平面座標 → シーンの x, z（x = 東、z = 南） */
export function planToScene(p: PlanXY): [number, number] {
  return [p[0], -p[1]]
}

/** 長方形の部屋・ゾーンの、シーンの x, z の範囲（min = 北西、max = 南東） */
export function rectOf(name: string): { min: [number, number]; max: [number, number] } {
  const r = planRoom(name).rect
  if (!r) throw new Error(`labPlan: 長方形ではない（${name}）`)
  return { min: [r[0], -r[3]], max: [r[2], -r[1]] }
}

/** 円の部屋・ゾーンの、シーンの中心（x, z）と半径 */
export function circleOf(name: string): { center: [number, number]; radius: number } {
  const c = planRoom(name).circle
  if (!c) throw new Error(`labPlan: 円ではない（${name}）`)
  return { center: planToScene(c.center), radius: c.radius }
}
