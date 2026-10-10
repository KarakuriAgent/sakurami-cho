import type { P2 } from '../town/townData'

/**
 * 名前のある建物の外観の記録（sync-town が書くアセットの根の town/named.json。形の版 4。tools/town/named.mjs）。
 * 値は地図データ（setting-book/town/data/buildings.geojson）の属性をほぼそのまま。外形は反時計回り、平面座標（x = 東、y = 北）・標高 [m]
 */

export interface NamedEntrance {
  x: number
  y: number
  /** 外へ向く方位（北から時計回りの度） */
  bearing_deg: number
  kind: 'main' | 'side' | 'service' | string
  name?: string
  floor?: number | string
  /** 入口の点の地面の標高（地形を直した後） */
  ground: number
  [key: string]: unknown
}

export interface NamedPart {
  id: string
  name: string | null
  partKind: string | null
  ring: P2[]
  z: number | null
  height: number | null
  roofType: string | null
  roofColor: string | null
  [key: string]: unknown
}

export interface NamedTenant {
  id: string
  name: string
  kind: string | null
  floor: number | string | null
  x: number
  y: number
  [key: string]: unknown
}

export interface NamedSite {
  id: string
  name: string | null
  kind: string | null
  ring: P2[]
  z: number | null
  [key: string]: unknown
}

export interface NamedRecord {
  id: string
  name: string
  kind: string | null
  /** 用途の番号（buildingKit の USE と同じ。0 住宅・1 併用・2 商業・3 事務所・4 港・5 工房・6 公共・7 ラボ・8 学校・9 宗教） */
  use: number
  useText: string | null
  district: string | null
  /** 町並みの型（buildings.mjs の STYLE） */
  style: number
  /** 描くか（ラボは描かない） */
  drawn: boolean
  ring: P2[]
  /** 床（地面）の標高 */
  z: number
  zMin: number | null
  zMax: number | null
  /** 外形の頂点の地面の低い所・高い所（地形を直した後） */
  gLow: number
  gHigh: number
  floors: number | null
  height: number | null
  roofHeight: number | null
  roofType: string | null
  roofText: string | null
  roofColor: [number, number, number]
  wallText: string | null
  wallColor: [number, number, number]
  material: string | null
  /** 外壁の種類（buildingKit の FACADE） */
  facade: number
  /** 正面の向き（北から時計回りの度） */
  front: number | null
  frontEdge: [P2, P2] | null
  entrances: NamedEntrance[]
  parts: NamedPart[]
  tenants: NamedTenant[]
  sites: NamedSite[]
  /** 部屋の間取り（中を作る建物だけ。形の版 5） */
  rooms: NamedRoom[]
  /** そのほかの属性（sign・chimney・garage・terrace・under_viaduct・arch_*・hours・note など） */
  extra: Record<string, unknown>
}

/** 部屋（地図データの rooms。平面の多角形は反時計回り） */
export interface NamedRoom {
  name: string
  floor: number
  position: string | null
  ring: P2[]
  note: string | null
}

export type NamedGeom = { type: 'point'; at: P2 } | { type: 'line'; pts: P2[] } | { type: 'lines'; lines: P2[][] } | { type: 'ring'; ring: P2[] }

export interface NamedStructure {
  id: string
  name: string | null
  kind: string | null
  geom: NamedGeom
  z: number
  ground: number
  height: number | null
  [key: string]: unknown
}

export interface NamedFile {
  buildings: NamedRecord[]
  structures: NamedStructure[]
}
