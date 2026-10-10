/**
 * 町の歩く道のグラフ（sync-town が書くアセットの根の town/walk.json。tools/town/walkgraph.mjs）の形。
 * 座標は町の平面座標（m。x = 東、y = 北。ラボの床の中心が原点）。標高は m（平均海面から）。
 *
 * このファイルは bun（tools/check-walk.mjs）からも読むので、ほかのファイルを import しない。
 */

/** 辺の種類（walkgraph.mjs の EDGE_KIND と同じ） */
export const EDGE_KIND = { road: 0, stairs: 1, bridge: 2, underground: 3, plaza: 4, cableBoard: 5, cable: 6 } as const
export type EdgeKind = (typeof EDGE_KIND)[keyof typeof EDGE_KIND]

export interface WalkEdge {
  /** 両端の節点 */
  a: number
  b: number
  /** 種類（EDGE_KIND） */
  k: EdgeKind
  /** 長さ（m。ケーブルの乗り降り・ケーブルは 0） */
  l: number
  /** a → b・b → a の時間（分） */
  tf: number
  tb: number
  /** 元の線（feats の番号。広場・ケーブルは −1） */
  f: number
  /** 名前（names の番号。無ければ −1） */
  n: number
  /** 途中の点（x, y の平らな配列。両端の節点は含まない） */
  p: number[]
}

export interface WalkFeat {
  id: string
  layer: 'road' | 'stairs' | 'bridge'
  /** 道の種類（trunk / arterial / local / alley / pedestrian / path / tram_row など） */
  cls: string | null
  width: number
  /** 街区の中の私道（自動の路地） */
  private: boolean
  surface: string | null
}

/** 石段（roads.geojson の stairs）。pts は [x, y, 標高]（下端 → 上端） */
export interface WalkStairs {
  id: string
  name: string | null
  pts: [number, number, number][]
  steps: number
  riser: number
  tread: number
  width: number
  landings: number
  landingLen: number
  rise: number | null
  surface: string | null
}

export interface WalkFile {
  format: number
  /** 節点（x, y の平らな配列） */
  nodes: number[]
  edges: WalkEdge[]
  names: string[]
  feats: WalkFeat[]
  /** 道の上に重なる橋（その区間の道の高さは橋の路面 deck） */
  decks: { id: string; pts: [number, number][]; deck: number | null; width: number }[]
  /** 広場（中を自由に歩ける。nodes = 広場から 3m 以内の節点） */
  plazas: { id: string; name: string | null; ring: [number, number][]; nodes: number[] }[]
  stairs: WalkStairs[]
  /** 踏切 */
  crossings: { id: string; kind: string | null; road: string | null; rail: string | null; x: number; y: number }[]
  /** ケーブルの駅（node = 駅の節点、street = 駅前の道の節点） */
  cable: { id: string; name: string; node: number; street: number; x: number; y: number; z: number | null; chainage: number }[]
  /** 検算（sync で数えたもの）: 道の中心線に建物の足元がかかる所（地図データの建物。駅舎・門の中へ入る道）と、道の面（中心線と幅）にかかる街区の自動の建物（0 のはず） */
  check?: { buildingsOnRoads: number; autoOnRoads?: number }
}
