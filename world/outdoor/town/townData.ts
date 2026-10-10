import { TOWN_DATA } from '../../../core/town'
import { townOptions, type TownStatus } from '../../townHost'
import { fetchBinary, parseContainer, type Container } from './container'
import { loadTownTextures, type TownTextureImages } from './townTextures'
import type { NamedFile } from '../named/namedData'
import type { TownTransit } from '../transit/transitData'
import type { WalkFile } from '../../../core/walk/walkData'

/**
 * 町の地図データ（sync-town がアセットの根の town/ に書いたもの）を読む。
 *
 * 読む順: 目録（manifest.json）→ 地形の高さ・地面の画像・水面と線路など（infra.json）→ 建物・木・灯りの区画（タイル）を近い順に。
 * タイルは「窓から見える所」だけ読む（ラボのまわり 700m と、南の窓から見える方角 55°〜305° に掛かる区画。北側の丘の向こうは読まない。
 * 撮影モードはカメラが窓の外へ出られるので全部読む）。
 * データが無い・形の版が違うときは、画面とコンソールに `pnpm sync:town` の案内を出す（ui/TownNotice.tsx）。
 */

/* -------------------------------------------------------------------------- */
/* データの形                                                                    */
/* -------------------------------------------------------------------------- */

export interface Extent {
  xmin: number
  xmax: number
  ymin: number
  ymax: number
  pixel_m: number
  width: number
  height: number
}

export interface TileEntry {
  key: string
  file: string
  bounds: [number, number, number, number]
  buildings: number
  trees: number
  lights: number
  bytes: number
}

export interface NamedBuilding {
  id: string
  name: string
  kind: string | null
  district: string | null
  x: number
  y: number
  z: number | null
  height: number | null
  /** planned = 中まで作る予定（段階 4）、exterior = 外観だけ */
  interior: 'planned' | 'exterior'
  drawn: boolean
}

export interface TownManifest {
  format: number
  generatedAt: string
  source: { path: string; signature: string; name: string }
  terrain: Record<'center' | 'overview', { file: string; extent: Extent }>
  ground: Record<'center' | 'overview', { albedo: string; aux: string; extent: Extent; auxPixel: number }>
  infra: string
  /** 名前のある建物の外観の記録（形の版 4。named/namedData.ts） */
  namedFile: string
  /** 町の歩く道のグラフ（形の版 9。core/walk/walkData.ts） */
  walkFile: string
  tiles: { size: number; list: TileEntry[] }
  landmarks: { station: [number, number]; townCenter: [number, number] }
  named: NamedBuilding[]
  stats: { buildings: number; buildingsFromData: number; buildingsAutoFill: number; trees: number; lights: number; bytes: number }
}

export type P2 = [number, number]
export type P3 = [number, number, number]

export interface TownInfra {
  water: { pos: number[]; idx: number[]; kind: number[] }
  streams: { pts: P3[]; width: number }[]
  walls: { pts: P2[]; top?: number; bottom?: number; follow?: number; kind: string }[]
  breakwaters: { pts: P2[]; width: number; crest: number }[]
  rails: { id: string; pts: P3[]; structure: string; tracks: number; arches: number; archSpan: number | null }[]
  tracks: { id: string; pts: P3[] }[]
  platforms: { ring: P2[]; top: number; roof: string | null }[]
  bridges: { pts: P3[]; width: number; deck: number | null; stone: boolean }[]
  cable: { pts: P3[]; loops: P3[][]; cars: { name: string; role: string; color: string | null; at: P3 }[] } | null
  structures: TownStructure[]
  coastLights: { id: string; name: string; x: number; y: number; focal: number; character: string | null; range: number | null }[]
  /** ラボのまわりの道と広場（形の版 3。ラボの前のセットの縁石つきの舗装と、花音の通り道） */
  site?: { paths: TownSitePath[]; plazas: { id: string; name: string | null; surface: string | null; ring: P2[] }[] }
  /** 交通（形の版 7。transit/transitData.ts） */
  transit?: TownTransit
}

/** ラボのまわりの道（平面座標の中心線・幅 m・種類（path / local / alley / tram_row）・路面） */
export interface TownSitePath {
  id: string
  name: string | null
  cls: string | null
  width: number
  surface: string | null
  pts: P2[]
}

export type TownStructure =
  | { type: 'soranowa'; id: string; x: number; y: number; z: number; axis: number; height: number; diameter: number; gondolas: number }
  | { type: 'crane'; id: string; x: number; y: number; z: number; axis: number; w: number; d: number; height: number; boom: number }
  | { type: 'lighthouse'; id: string; x: number; y: number; z: number; r: number; height: number; color: 'red' | 'white'; focal: number; character: string | null; main: boolean }
  | { type: 'parabola'; id: string; x: number; y: number; z: number; dish: number; top: number; center: number; azimuth: number; elevation: number }
  | { type: 'monument'; id: string; x: number; y: number; z: number; r: number; height: number }
  | { type: 'belfry'; id: string; x: number; y: number; z: number; axis: number; w: number; d: number; height: number }
  | { type: 'lamppost'; id: string; x: number; y: number; z: number; height: number }
  | { type: 'gate'; id: string; pts: P2[]; z: number; height: number }
  | { type: 'statue'; id: string; x: number; y: number; z: number; r: number; height: number }
  | { type: 'gardenDome'; id: string; x: number; y: number; z: number; r: number; height: number }

/** 形のある建物（長方形でない建物・建物の部分）。タイルの見出しに入っている */
export interface PolyBuilding {
  id: string
  name: string | null
  ring: P2[]
  floorZ: number
  base: number
  eave: number
  ridge: number
  roof: number
  special: 'dome' | 'spire' | 'chimney' | 'canopy' | 'clocktower' | null
  facade: number
  use: number
  flags: number
  floors: number
  wall: [number, number, number]
  roofColor: [number, number, number]
  seed: number
  /** 町並みの型（buildingKit.ts の STYLE） */
  style: number
  namedIndex: number
}

export interface TileMeta {
  kind: 'tile'
  key: string
  bounds: [number, number, number, number]
  counts: { rects: number; polys: number; trees: number; lights: number }
  polys: PolyBuilding[]
}

export type TownTile = Container<TileMeta>

/* -------------------------------------------------------------------------- */
/* 地形の高さ                                                                    */
/* -------------------------------------------------------------------------- */

export class HeightLayer {
  readonly extent: Extent
  /** 高さ（u16: z = v / 100 - 50） */
  readonly height: Uint16Array
  /** 水の種類（0 陸・1 海・2 川・3 運河・4 池） */
  readonly water: Uint8Array

  constructor(c: Container<{ extent: Extent }>) {
    const e = c.meta.extent
    this.extent = { ...e, xmax: e.xmin + e.width * e.pixel_m, ymin: e.ymax - e.height * e.pixel_m }
    // 行ごとに左との差になっているので足し戻す
    const delta = c.sections.height.array as Uint16Array
    const out = new Uint16Array(delta.length)
    for (let r = 0; r < e.height; r++) {
      let v = 0
      const row = r * e.width
      for (let i = 0; i < e.width; i++) {
        v = (v + delta[row + i]) & 0xffff
        out[row + i] = v
      }
    }
    this.height = out
    this.water = c.sections.water.array as Uint8Array
  }

  contains(x: number, y: number, marginPx = 1) {
    const e = this.extent
    const m = marginPx * e.pixel_m
    return x > e.xmin + m && x < e.xmax - m && y > e.ymin + m && y < e.ymax - m
  }

  /** 双一次補間の標高（範囲の外は端の値） */
  sample(x: number, y: number) {
    const e = this.extent
    const fc = Math.min(e.width - 1.001, Math.max(0, (x - e.xmin) / e.pixel_m - 0.5))
    const fr = Math.min(e.height - 1.001, Math.max(0, (e.ymax - y) / e.pixel_m - 0.5))
    const c = Math.floor(fc)
    const r = Math.floor(fr)
    const tx = fc - c
    const ty = fr - r
    const i = r * e.width + c
    const h = this.height
    const a = h[i]
    const b = h[i + 1]
    const cc = h[i + e.width]
    const d = h[i + e.width + 1]
    return (a + (b - a) * tx + (cc - a) * ty + (a - b - cc + d) * tx * ty) / 100 - 50
  }

  waterAt(x: number, y: number) {
    const e = this.extent
    const c = Math.min(e.width - 1, Math.max(0, Math.floor((x - e.xmin) / e.pixel_m)))
    const r = Math.min(e.height - 1, Math.max(0, Math.floor((e.ymax - y) / e.pixel_m)))
    return this.water[r * e.width + c]
  }
}

/* -------------------------------------------------------------------------- */
/* 読み込み                                                                      */
/* -------------------------------------------------------------------------- */

export interface GroundImages {
  center: { albedo: ImageBitmap; aux: ImageBitmap }
  overview: { albedo: ImageBitmap; aux: ImageBitmap }
}

/** 窓から見えるタイルか（ラボのまわり 700m か、方角 55°〜305° に掛かる） */
export function tileVisible(b: [number, number, number, number]) {
  const nx = Math.max(b[0], Math.min(0, b[2]))
  const ny = Math.max(b[1], Math.min(0, b[3]))
  if (Math.hypot(nx, ny) < 700) return true
  const pts: P2[] = [
    [b[0], b[1]],
    [b[2], b[1]],
    [b[0], b[3]],
    [b[2], b[3]],
    [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2],
  ]
  return pts.some(([x, y]) => {
    const bearing = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360
    return bearing > 55 && bearing < 305
  })
}

/** 町の地図データの置き場（地図の引数 assetBase の下の TOWN_DATA.dir。初めて使うとき（読み込みを始めるとき）に決める） */
let dataBase: string | null = null
const townDataBase = () => (dataBase ??= `${townOptions().assetBase}${TOWN_DATA.dir}/`)

class TownData {
  status: TownStatus = 'idle'
  message = ''
  manifest: TownManifest | null = null
  center: HeightLayer | null = null
  overview: HeightLayer | null = null
  ground: GroundImages | null = null
  infra: TownInfra | null = null
  /** 名前のある建物の外観の記録（named.json） */
  named: NamedFile | null = null
  /** 町の歩く道のグラフ（walk.json。world/walk/townWalk.ts が使う） */
  walk: WalkFile | null = null
  /** 町の質感の画像（townTextures.ts。読めない画像は null） */
  textures: TownTextureImages | null = null
  /** 読み終えたタイル（読んだ順） */
  readonly tiles: TownTile[] = []
  /** 読む予定のタイルの数 */
  tilesPlanned = 0
  private started = false
  private listeners = new Set<() => void>()

  /** 状態が変わったら呼ぶ */
  subscribe(cb: () => void) {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit() {
    for (const cb of this.listeners) cb()
  }

  private setStatus(status: TownStatus, message = '') {
    this.status = status
    this.message = message
    townOptions().onStatus(status, message)
    this.emit()
  }

  /** 地面の標高（m）。中心の 1m の高さ画像が優先、外は全体の 5m、全体の外は端の値 */
  heightAt(x: number, y: number) {
    if (this.center?.contains(x, y)) return this.center.sample(x, y)
    return this.overview?.sample(x, y) ?? 0
  }

  waterAt(x: number, y: number) {
    if (this.center?.contains(x, y)) return this.center.waterAt(x, y)
    if (this.overview?.contains(x, y)) return this.overview.waterAt(x, y)
    return 1
  }

  /** 読み込みを始める（何度呼んでも 1 回だけ） */
  start() {
    if (this.started) return
    this.started = true
    void this.load()
  }

  private async load() {
    this.setStatus('loading')
    const base = townDataBase()
    let manifest: TownManifest
    try {
      const res = await fetch(`${base}manifest.json`, { cache: 'no-cache' })
      const type = res.headers.get('content-type') ?? ''
      // 開発サーバは無いファイルにも index.html を返すので、中身の形でも確かめる
      if (!res.ok || !type.includes('json')) throw new Error('missing')
      manifest = (await res.json()) as TownManifest
    } catch {
      console.error(`[sakurami-cho] 町の地図データ（${base}manifest.json）がありません。アセットの根の town/ に町の地図データ（tools/sync-town.mjs で書き出す）を置いてから、ページを読み込み直してください。`)
      this.setStatus('missing')
      return
    }
    if (manifest.format !== TOWN_DATA.format) {
      console.error(`[sakurami-cho] 町の地図データの形が古い・新しい（${manifest.format}、アプリは ${TOWN_DATA.format}）。町の地図データ（アセットの根の town/）を tools/sync-town.mjs で書き出し直してください。`)
      this.setStatus('outdated', String(manifest.format))
      return
    }
    this.manifest = manifest
    try {
      const image = async (rel: string) => {
        const res = await fetch(base + rel)
        if (!res.ok) throw new Error(`${rel}: ${res.status}`)
        // 色は sRGB のまま・アルファは掛けない（A は陸か海かの印）
        return createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none', imageOrientation: 'none' })
      }
      const [center, overview, gc, gca, go, goa, infra, textures, named, walk] = await Promise.all([
        fetchBinary(base + manifest.terrain.center.file),
        fetchBinary(base + manifest.terrain.overview.file),
        image(manifest.ground.center.albedo),
        image(manifest.ground.center.aux),
        image(manifest.ground.overview.albedo),
        image(manifest.ground.overview.aux),
        fetch(base + manifest.infra).then((r) => r.json() as Promise<TownInfra>),
        loadTownTextures(),
        fetch(base + manifest.namedFile).then((r) => r.json() as Promise<NamedFile>),
        fetch(base + manifest.walkFile).then((r) => r.json() as Promise<WalkFile>),
      ])
      this.textures = textures
      this.named = named
      this.walk = walk
      this.center = new HeightLayer(parseContainer(center))
      this.overview = new HeightLayer(parseContainer(overview))
      this.ground = { center: { albedo: gc, aux: gca }, overview: { albedo: go, aux: goa } }
      this.infra = infra
      this.emit()
      // タイル: 近い順に、6 本ずつ並べて読む
      const allTiles = townOptions().allTiles
      const list = manifest.tiles.list
        // カメラが窓の外へ出られるとき（撮影モード）は、全部のタイルを読む
        .filter((t) => allTiles || tileVisible(t.bounds))
        .map((t) => ({ t, d: Math.hypot(Math.max(t.bounds[0], Math.min(0, t.bounds[2])), Math.max(t.bounds[1], Math.min(0, t.bounds[3]))) }))
        .sort((a, b) => a.d - b.d)
        .map((e) => e.t)
      this.tilesPlanned = list.length
      let next = 0
      const worker = async () => {
        while (next < list.length) {
          const entry = list[next++]
          const tile = parseContainer<TileMeta>(await fetchBinary(base + entry.file))
          this.tiles.push(tile)
          this.emit()
        }
      }
      await Promise.all(Array.from({ length: 6 }, worker))
    } catch (e) {
      console.error('[sakurami-cho] 町の地図データを読めませんでした。町の地図データ（アセットの根の town/）を tools/sync-town.mjs で書き出し直してください。', e)
      this.setStatus('error', String(e))
      return
    }
    this.emit()
  }

  /** 町を組み立て終えた（Landscape が呼ぶ） */
  markReady() {
    if (this.status === 'loading') this.setStatus('ready')
  }

  /**
   * 窓から見えないので最初に読まなかったタイル（配信。北の丘の向こう）。花音が町を歩き出したら読む（loadAllTiles）。
   * 細かさの中心がラボから離れたとき（outdoor/landscape.ts の relod）と、町の当たりの形（world/walk/townSolids.ts）が使う
   */
  readonly extraTiles = new Map<string, TownTile>()
  private extraState: 'none' | 'loading' | 'done' = 'none'

  /** 残りのタイルを読み始める（何度呼んでもよい。allTiles（撮影モード）は初めから全部読んでいる） */
  loadAllTiles() {
    if (this.extraState !== 'none' || !this.manifest || townOptions().allTiles) return
    this.extraState = 'loading'
    const base = townDataBase()
    const have = new Set(this.tiles.map((t) => t.meta.key))
    const list = this.manifest.tiles.list.filter((t) => !have.has(t.key))
    let next = 0
    const worker = async () => {
      while (next < list.length) {
        const entry = list[next++]
        const tile = parseContainer<TileMeta>(await fetchBinary(base + entry.file))
        this.extraTiles.set(tile.meta.key, tile)
      }
    }
    void Promise.all(Array.from({ length: 4 }, worker))
      .then(() => {
        this.extraState = 'done'
        this.emit()
      })
      .catch((e) => console.warn('[sakurami-cho] 町の残りのタイルを読めませんでした', e))
  }

  /** 全部のタイルを読んだか */
  allTilesLoaded() {
    return townOptions().allTiles || this.extraState === 'done' || (this.manifest !== null && this.tiles.length >= this.manifest.tiles.list.length)
  }

  /** 最初に読まなかったタイル（読んでいれば） */
  extraTile(key: string) {
    return this.extraTiles.get(key) ?? null
  }

  /** 細かさの中心 center（平面座標）のまわりを組み立てるときのタイル（ラボから遠いときは、読んだ残りのタイルも） */
  tilesFor(center: [number, number]): TownTile[] {
    if (!this.extraTiles.size || Math.hypot(center[0], center[1]) < 300) return this.tiles
    return [...this.tiles, ...this.extraTiles.values()]
  }
}

export const townData = new TownData()
