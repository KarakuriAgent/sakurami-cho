/**
 * 町の地図（ミニマップと全体の地図。#1）の材料: 町の地図データ（アセットの根の town/walk.json・infra.json・named.json）から、2D の canvas に描く形
 * （線・面・建物の外形。町の平面座標 m: x = 東、y = 北。ラボの床の中心が原点）を作る所と、座標の決まり。
 * 地図のパッケージの公開の口には地図データの中身を出す口が無いので、例のアプリが同じファイルをアセットの根から読み、形はここで決める
 * （中身の形は地図のパッケージの core/walk/walkData.ts の WalkFile と world/outdoor/town/townData.ts の TownInfra・named。版は町の状態 ready で確かめ済み）。
 *
 * このファイルは DOM・three・React・地図のパッケージ・ほかのモジュールを読まない（テスト test/town-walker-map.test.ts が bun で読む）。
 *
 * - シーンの座標（three: x = 東、z = 南）と町の平面座標は x = x・y = −z
 * - 歩く人の向き（motion.heading。three の rotation.y で、0 = 南（+z）を向く）を、北が上の地図の上の矢印の回り（時計回りの度。0 = 上 = 北）にする
 */

/** 町の平面座標の点 */
export type P2 = readonly [number, number]

/** 囲み（町の平面座標 m） */
export interface Box {
  xmin: number
  xmax: number
  ymin: number
  ymax: number
}

/** 道の種類（描き分け）: 大きな道・ふつうの道・路地・街区の中の私道・歩く道（歩行者・小径）・石段・橋・ラボの敷地の道 */
export type RoadClass = 'major' | 'local' | 'alley' | 'private' | 'path' | 'stairs' | 'bridge'

/** 線（点は x, y の平らな配列）と幅（m）と囲み */
export interface MapLine {
  pts: Float64Array
  width: number
  box: Box
}

export interface MapRoad extends MapLine {
  cls: RoadClass
}

export interface MapRail extends MapLine {
  /** トンネルの中（点線にする） */
  tunnel: boolean
}

export interface MapTram extends MapLine {
  /** 系統の番号（乗っている便の car.line） */
  no: number
  name: string
  color: string
}

/** 面（外の輪。点は x, y の平らな配列） */
export interface MapArea {
  ring: Float64Array
  box: Box
}

export interface MapBuilding extends MapArea {
  id: string
  name: string
  /** 外形の重心のあたり（名前・印を置く所） */
  cx: number
  cy: number
}

export interface MapModel {
  /** 歩く道のグラフの広がり（全体の地図で動かせる広さ） */
  bounds: Box
  roads: MapRoad[]
  /** 川・運河・池の水面（3 つで 1 つの三角。x, y の平らな配列）と、その囲み */
  water: { tris: Float64Array; box: Box }
  /** 小川（幅のある線） */
  streams: MapLine[]
  plazas: MapArea[]
  rails: MapRail[]
  /** ケーブルの線（無ければ null） */
  cable: MapLine | null
  trams: MapTram[]
  buildings: MapBuilding[]
}

/* -------------------------------------------------------------------------- */
/* 座標                                                                          */
/* -------------------------------------------------------------------------- */

/** シーンの x, z → 町の平面座標 */
export const planeOf = (x: number, z: number): [number, number] => [x, -z]

/**
 * 歩く人の向き（ラジアン。three の rotation.y。0 = 南（+z）・π/2 = 東（+x））→ 北が上の地図の矢印の回り（度。時計回り、0 = 北・90 = 東・180 = 南）。
 * 向きの前は (sin h, cos h)（x, z）なので、北が上の画面では右へ sin h・下へ cos h
 */
export function arrowDegrees(heading: number): number {
  const d = 180 - (heading * 180) / Math.PI
  return ((d % 360) + 360) % 360
}

/** 行き先の名前を地図に出す短い形（「（」からあとの説明を外す） */
export function shortLabel(label: string): string {
  const i = label.indexOf('（')
  return (i > 0 ? label.slice(0, i) : label).trim()
}

const emptyBox = (): Box => ({ xmin: Infinity, xmax: -Infinity, ymin: Infinity, ymax: -Infinity })

function boxOf(flat: ArrayLike<number>): Box {
  const b = emptyBox()
  for (let i = 0; i + 1 < flat.length; i += 2) grow(b, flat[i]!, flat[i + 1]!)
  return b
}

function grow(b: Box, x: number, y: number) {
  if (x < b.xmin) b.xmin = x
  if (x > b.xmax) b.xmax = x
  if (y < b.ymin) b.ymin = y
  if (y > b.ymax) b.ymax = y
}

/** 2 つの囲みが重なるか（pad m だけ広げて） */
export const overlaps = (a: Box, b: Box, pad = 0) => a.xmin - pad <= b.xmax && a.xmax + pad >= b.xmin && a.ymin - pad <= b.ymax && a.ymax + pad >= b.ymin

/** 点が外形の中か（偶奇の規則） */
export function insideRing(ring: ArrayLike<number>, x: number, y: number): boolean {
  let inside = false
  const n = ring.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2]!
    const yi = ring[i * 2 + 1]!
    const xj = ring[j * 2]!
    const yj = ring[j * 2 + 1]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/* -------------------------------------------------------------------------- */
/* 地図データ → 描く形                                                           */
/* -------------------------------------------------------------------------- */

/** 読む地図データの形（使う所だけ。町の地図データの形の版 10） */
export interface WalkJson {
  nodes: number[]
  edges: { a: number; b: number; k: number; f: number; p: number[] }[]
  feats: { layer: string; cls: string | null; width: number; private: boolean }[]
  plazas: { ring: [number, number][] }[]
}

export interface InfraJson {
  water: { pos: number[]; idx: number[] }
  streams: { pts: number[][]; width: number }[]
  rails: { pts: number[][]; structure: string; tracks: number }[]
  cable: { pts: number[][] } | null
  site?: { paths: { cls: string | null; width: number; pts: number[][] }[]; plazas: { ring: [number, number][] }[] }
  transit?: { trams: { no: number; name: string; color: string; pts: number[][] }[] }
}

export interface NamedJson {
  buildings: { id: string; name: string; ring: [number, number][] }[]
}

/** 歩く道の辺の種類（core/walk/walkData.ts の EDGE_KIND）: 道・石段・橋・地下・広場・ケーブルの乗り降り・ケーブル */
const EDGE = { road: 0, stairs: 1, bridge: 2, underground: 3, plaza: 4 } as const

function roadClass(layer: string, cls: string | null, priv: boolean): RoadClass {
  if (layer === 'stairs') return 'stairs'
  if (layer === 'bridge') return 'bridge'
  if (priv) return 'private'
  if (cls === 'trunk' || cls === 'arterial' || cls === 'tram_row') return 'major'
  if (cls === 'local') return 'local'
  if (cls === 'alley') return 'alley'
  return 'path'
}

const flat2 = (pts: readonly (readonly number[])[]) => {
  const out = new Float64Array(pts.length * 2)
  pts.forEach((p, i) => {
    out[i * 2] = p[0]!
    out[i * 2 + 1] = p[1]!
  })
  return out
}

function line(pts: Float64Array, width: number): MapLine {
  return { pts, width, box: boxOf(pts) }
}

function area(ring: readonly (readonly number[])[]): MapArea {
  const r = flat2(ring)
  return { ring: r, box: boxOf(r) }
}

/** 町の地図データ（3 つのファイルを JSON にした物）から描く形を作る */
export function buildMapModel(walk: WalkJson, infra: InfraJson, named: NamedJson): MapModel {
  const n = walk.nodes
  const roads: MapRoad[] = []
  const plazas: MapArea[] = []
  for (const e of walk.edges) {
    // 広場は面で描く・地下とケーブルの乗り降り・ケーブルは描かない
    if (e.k !== EDGE.road && e.k !== EDGE.stairs && e.k !== EDGE.bridge) continue
    const feat = walk.feats[e.f]
    const pts = new Float64Array(4 + e.p.length)
    pts[0] = n[e.a * 2]!
    pts[1] = n[e.a * 2 + 1]!
    pts.set(e.p, 2)
    pts[2 + e.p.length] = n[e.b * 2]!
    pts[3 + e.p.length] = n[e.b * 2 + 1]!
    const cls = e.k === EDGE.stairs ? 'stairs' : e.k === EDGE.bridge ? 'bridge' : roadClass(feat?.layer ?? 'road', feat?.cls ?? null, !!feat?.private)
    roads.push({ ...line(pts, feat?.width ?? 3), cls })
  }
  for (const p of walk.plazas) plazas.push(area(p.ring))
  // ラボの敷地の道と広場（歩く道のグラフの外。ラボのまわり）
  for (const p of infra.site?.paths ?? []) roads.push({ ...line(flat2(p.pts), p.width), cls: p.cls === 'local' || p.cls === 'tram_row' ? 'local' : p.cls === 'alley' ? 'alley' : 'path' })
  for (const p of infra.site?.plazas ?? []) plazas.push(area(p.ring))

  const w = infra.water
  const tris = new Float64Array(w.idx.length * 2)
  w.idx.forEach((v, i) => {
    tris[i * 2] = w.pos[v * 3]!
    tris[i * 2 + 1] = w.pos[v * 3 + 1]!
  })

  const bounds = boxOf(n)
  return {
    bounds,
    roads,
    water: { tris, box: boxOf(tris) },
    streams: infra.streams.map((s) => line(flat2(s.pts), s.width)),
    plazas,
    rails: infra.rails.map((r) => ({ ...line(flat2(r.pts), r.tracks > 1 ? 9 : 5), tunnel: r.structure === 'tunnel' })),
    cable: infra.cable && infra.cable.pts.length > 1 ? line(flat2(infra.cable.pts), 3) : null,
    trams: (infra.transit?.trams ?? []).map((t) => ({ ...line(flat2(t.pts), 3), no: t.no, name: t.name, color: t.color })),
    buildings: named.buildings
      .filter((b) => b.ring.length >= 3)
      .map((b) => {
        const a = area(b.ring)
        return { ...a, id: b.id, name: b.name, cx: (a.box.xmin + a.box.xmax) / 2, cy: (a.box.ymin + a.box.ymax) / 2 }
      }),
  }
}

/* -------------------------------------------------------------------------- */
/* ミニマップの描き直し                                                           */
/* -------------------------------------------------------------------------- */

/**
 * ミニマップは、見せる広さ（半径 r m）の 2 倍の広さを下絵（buffer）に描いておき、毎コマは下絵をずらすだけにする。
 * 下絵の中心から歩く人が r × MINIMAP_SHIFT より離れたら、歩く人を中心に描き直す（見せる所が下絵の外へ出ないうちに）
 */
export const MINIMAP_SHIFT = 0.6

/** 下絵を描き直すか（中心 bx, by の下絵で、歩く人が x, y にいるとき） */
export const needsRecenter = (bx: number, by: number, x: number, y: number, radius: number) => Math.hypot(x - bx, y - by) > radius * MINIMAP_SHIFT
