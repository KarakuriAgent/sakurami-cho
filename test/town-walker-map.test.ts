/**
 * 例のアプリ town-walker の町の地図（#1。examples/town-walker/src/mapData.ts・mapDraw.ts）の見張り:
 *   - 座標: シーン（x = 東、z = 南）→ 町の平面座標（x = 東、y = 北）、歩く人の向き（rotation.y。0 = 南）→ 北が上の地図の矢印の回り（時計回りの度。0 = 北）
 *   - 町の地図データ（assets/town/ の walk.json・infra.json・named.json）から描く形を作る: 道・水・線路・ケーブル・緑電の系統・名前のある建物。
 *     印を付ける建物（ラボ・中のある建物のゾーンの建物）がどれもあり、ラボの外形の中に原点がある。行き先の 45 か所は地図の広がりの中
 *   - 地図データの欄が欠けていても（ラボの敷地・交通・ケーブルが無い）作れる
 *   - ミニマップの下絵は、歩く人が中心から半径の MINIMAP_SHIFT 倍より離れたら描き直す
 *   - 描く: 見える広さの外の物は描かない（狭い所を描くと線の数がずっと少ない）。乗っている緑電の系統とケーブルは太く描き、中にいる建物に印を付ける。
 *     行き先の名前は重ならない物だけ出し、選んだ物は必ず出す
 * canvas は使わず、2D の口の呼び出しを数える物で描く
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { INTERIOR_ZONES, TOWN_PLACES, TRAVEL_PLACES } from '../core/index.ts'
import {
  arrowDegrees,
  buildMapModel,
  insideRing,
  MINIMAP_SHIFT,
  needsRecenter,
  planeOf,
  shortLabel,
  type InfraJson,
  type NamedJson,
  type WalkJson,
} from '../examples/town-walker/src/mapData.ts'
import { drawBase, drawPins, MAP_COLORS, toPlaneX, toPlaneY, toScreenX, toScreenY, type MapView } from '../examples/town-walker/src/mapDraw.ts'

const TOWN = join(import.meta.dir, '..', 'assets', 'town')
const json = <T>(f: string) => JSON.parse(readFileSync(join(TOWN, f), 'utf8')) as T
const walk = json<WalkJson>('walk.json')
const infra = json<InfraJson>('infra.json')
const named = json<NamedJson>('named.json')
const model = buildMapModel(walk, infra, named)

/** 2D の口の呼び出しを数える物（描いた線の色と太さも覚える） */
function fakeContext() {
  const calls: Record<string, number> = {}
  const strokes: { color: string; width: number }[] = []
  const texts: string[] = []
  const count = (n: string) => (calls[n] = (calls[n] ?? 0) + 1)
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textBaseline: '',
    textAlign: '',
    lineJoin: '',
    lineCap: '',
    save: () => count('save'),
    restore: () => count('restore'),
    fillRect: () => count('fillRect'),
    clearRect: () => count('clearRect'),
    beginPath: () => count('beginPath'),
    moveTo: () => count('moveTo'),
    lineTo: () => count('lineTo'),
    closePath: () => count('closePath'),
    arc: () => count('arc'),
    fill: () => count('fill'),
    stroke() {
      count('stroke')
      strokes.push({ color: String(ctx.strokeStyle), width: ctx.lineWidth })
    },
    setLineDash: () => count('setLineDash'),
    drawImage: () => count('drawImage'),
    translate: () => count('translate'),
    rotate: () => count('rotate'),
    measureText: (t: string) => ({ width: t.length * 10 }),
    strokeText: () => count('strokeText'),
    fillText(t: string) {
      count('fillText')
      texts.push(t)
    },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, strokes, texts }
}

const view = (cx: number, cy: number, metres: number, size = 400): MapView => ({ cx, cy, scale: size / metres, width: size, height: size, px: 1 })

describe('座標', () => {
  test('シーン → 町の平面座標は x = x・y = −z', () => {
    expect(planeOf(3, 4)).toEqual([3, -4])
    expect(planeOf(-700, 1373)).toEqual([-700, -1373])
  })

  test('向き → 北が上の矢印: 0 = 南向き → 180°、東 → 90°、北 → 0°、西 → 270°', () => {
    expect(arrowDegrees(0)).toBeCloseTo(180)
    expect(arrowDegrees(Math.PI / 2)).toBeCloseTo(90)
    expect(arrowDegrees(Math.PI)).toBeCloseTo(0)
    expect(arrowDegrees(-Math.PI / 2)).toBeCloseTo(270)
    expect(arrowDegrees(Math.PI * 2.5)).toBeCloseTo(90)
    // 矢印の向きと、その向きに 1m 進んだ点が地図の上でずれる向きが同じ（北が上: 画面の右 = 東 +x、下 = 南 +z）
    for (const h of [0, 0.4, 1.3, 2.9, -2.2]) {
      const rad = (arrowDegrees(h) * Math.PI) / 180
      // 矢印（上向きを時計回りに rad 回した物）の画面の向き（右 +、下 +）と、進む向き（東 = sin h・南 = cos h）
      expect(Math.sin(rad)).toBeCloseTo(Math.sin(h))
      expect(-Math.cos(rad)).toBeCloseTo(Math.cos(h))
    }
  })

  test('地図の px と町の平面座標を行き来する（北が上: 北へ行くと画面の上）', () => {
    const v = view(100, -200, 300)
    expect(toScreenX(v, 100)).toBe(200)
    expect(toScreenY(v, -200)).toBe(200)
    expect(toScreenY(v, -100)).toBeLessThan(200)
    expect(toPlaneX(v, toScreenX(v, 123))).toBeCloseTo(123)
    expect(toPlaneY(v, toScreenY(v, -321))).toBeCloseTo(-321)
  })

  test('行き先の短い名前は「（」の前まで', () => {
    expect(shortLabel('小野寺時計店の前（灯町二丁目 時計坂。祖父母の店。ルート E）')).toBe('小野寺時計店の前')
    expect(shortLabel('ラボの前')).toBe('ラボの前')
  })
})

describe('町の地図データ → 描く形', () => {
  test('道・水・線路・ケーブル・緑電の系統・名前のある建物がある。広がりは歩く道のグラフ', () => {
    expect(model.roads.length).toBeGreaterThan(6000)
    expect(new Set(model.roads.map((r) => r.cls))).toEqual(new Set(['major', 'local', 'alley', 'private', 'path', 'stairs', 'bridge']))
    expect(model.water.tris.length % 6).toBe(0)
    expect(model.water.tris.length).toBeGreaterThan(1000)
    expect(model.streams.length).toBe(infra.streams.length)
    expect(model.rails.length).toBe(infra.rails.length)
    expect(model.rails.some((r) => r.tunnel)).toBe(true)
    expect(model.cable).not.toBeNull()
    expect(model.trams.map((t) => t.no)).toEqual([1, 2, 3, 4])
    expect(model.buildings.length).toBe(named.buildings.length)
    const xs = walk.nodes.filter((_, i) => i % 2 === 0)
    expect(model.bounds.xmin).toBe(Math.min(...xs))
    expect(model.bounds.xmax).toBe(Math.max(...xs))
  })

  test('印を付ける建物（ラボ・中のある建物のゾーン）がどれもあり、ラボの外形の中に原点（ラボの床の中心）がある', () => {
    const ids = new Set(model.buildings.map((b) => b.id))
    expect(ids.has('building.sakuragioka.lab')).toBe(true)
    for (const z of Object.values(INTERIOR_ZONES)) expect(ids.has(z.buildingId)).toBe(true)
    const lab = model.buildings.find((b) => b.id === 'building.sakuragioka.lab')!
    expect(insideRing(lab.ring, 0, 0)).toBe(true)
    expect(insideRing(lab.ring, 0, 20)).toBe(false)
    // 中のある建物の印は、そのゾーンの中心の近く（ゾーンの半径の中）
    for (const z of Object.values(INTERIOR_ZONES)) {
      const b = model.buildings.find((x) => x.id === z.buildingId)!
      const [x, y] = planeOf(z.center[0], z.center[1])
      expect(Math.hypot(b.cx - x, b.cy - y)).toBeLessThan(z.radius + 30)
    }
  })

  test('行き先の 45 か所は地図の広がりの中', () => {
    const pts = [
      ...Object.values(TOWN_PLACES).map((p) => planeOf(p.position[0], p.position[2])),
      ...Object.values(TRAVEL_PLACES).map((p) => [p.at[0], p.at[1]] as const),
    ]
    expect(pts.length).toBe(45)
    const b = model.bounds
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(b.xmin)
      expect(x).toBeLessThanOrEqual(b.xmax)
      expect(y).toBeGreaterThanOrEqual(b.ymin)
      expect(y).toBeLessThanOrEqual(b.ymax)
    }
  })

  test('欄が欠けていても作れる（ラボの敷地・交通・ケーブル・水が無い）', () => {
    const m = buildMapModel(
      { nodes: [0, 0, 10, 0], edges: [{ a: 0, b: 1, k: 0, f: 0, p: [] }], feats: [{ layer: 'road', cls: 'local', width: 6, private: false }], plazas: [] },
      { water: { pos: [], idx: [] }, streams: [], rails: [], cable: null },
      { buildings: [] },
    )
    expect(m.roads.length).toBe(1)
    expect(m.cable).toBeNull()
    expect(m.trams).toEqual([])
    const f = fakeContext()
    drawBase(f.ctx, m, view(5, 0, 100), { highlight: { tram: 1, cable: true }, mark: 'building.x' })
    expect(f.calls.lineTo).toBe(1)
  })
})

describe('ミニマップの描き直し', () => {
  test('下絵の中心から半径の MINIMAP_SHIFT 倍より離れたら描き直す', () => {
    expect(MINIMAP_SHIFT).toBeLessThan(1)
    expect(needsRecenter(0, 0, 0, 150 * MINIMAP_SHIFT - 1, 150)).toBe(false)
    expect(needsRecenter(0, 0, 150 * MINIMAP_SHIFT + 1, 0, 150)).toBe(true)
    // 描き直すまでに見せる窓（半径）が下絵（半径の 2 倍）の外へ出ない
    expect(150 * MINIMAP_SHIFT + 150).toBeLessThanOrEqual(300)
  })
})

describe('描く', () => {
  test('見える広さの外の物は描かない（ラボのまわり 300m は町全体よりずっと少ない）', () => {
    const near = fakeContext()
    drawBase(near.ctx, model, view(0, 0, 300), { highlight: { tram: null, cable: false }, mark: null })
    const all = fakeContext()
    const b = model.bounds
    drawBase(all.ctx, model, view((b.xmin + b.xmax) / 2, (b.ymin + b.ymax) / 2, Math.max(b.xmax - b.xmin, b.ymax - b.ymin), 4000), { highlight: { tram: null, cable: false }, mark: null })
    expect(near.calls.lineTo ?? 0).toBeGreaterThan(0)
    expect((near.calls.lineTo ?? 0) * 20).toBeLessThan(all.calls.lineTo ?? 0)
    // 線はまとめて描く（道の種類と幅ごと）
    expect(all.calls.stroke ?? 0).toBeLessThan(80)
  })

  test('乗っている緑電の系統とケーブルは太く描き、中にいる建物に印を付ける', () => {
    const t = model.trams.find((x) => x.no === 2)!
    const v = view(t.pts[0]!, t.pts[1]!, 600)
    const plain = fakeContext()
    drawBase(plain.ctx, model, v, { highlight: { tram: null, cable: false }, mark: null })
    const ridden = fakeContext()
    drawBase(ridden.ctx, model, v, { highlight: { tram: 2, cable: false }, mark: null })
    const widest = (s: { color: string; width: number }[], c: string) => Math.max(0, ...s.filter((x) => x.color === c).map((x) => x.width))
    expect(widest(ridden.strokes, t.color)).toBeGreaterThan(widest(plain.strokes, t.color) * 3)

    const c = model.cable!
    const cv = view(c.pts[0]!, c.pts[1]!, 600)
    const cplain = fakeContext()
    drawBase(cplain.ctx, model, cv, { highlight: { tram: null, cable: false }, mark: null })
    const con = fakeContext()
    drawBase(con.ctx, model, cv, { highlight: { tram: null, cable: true }, mark: null })
    expect(widest(con.strokes, MAP_COLORS.cable)).toBeGreaterThan(widest(cplain.strokes, MAP_COLORS.cable) * 2)

    const lab = fakeContext()
    drawBase(lab.ctx, model, view(0, 0, 300), { highlight: { tram: null, cable: false }, mark: 'building.sakuragioka.lab' })
    expect(lab.strokes.some((s) => s.color === MAP_COLORS.markEdge)).toBe(true)
    expect(plain.strokes.some((s) => s.color === MAP_COLORS.markEdge)).toBe(false)
  })

  test('行き先の名前は重ならない物だけ出し、選んだ物は必ず出す', () => {
    const pins = [
      { id: 'a', label: 'ラボの前', x: 0, y: 0 },
      { id: 'b', label: 'テラス', x: 1, y: 0.5 },
      { id: 'c', label: '遠い所', x: 100, y: 100 },
      { id: 'd', label: '見えない所', x: 5000, y: 0 },
    ]
    const f = fakeContext()
    expect(drawPins(f.ctx, view(0, 0, 400), pins)).toBe(2)
    expect(f.texts).toEqual(['ラボの前', '遠い所'])
    const g = fakeContext()
    drawPins(g.ctx, view(0, 0, 400), pins, { selected: 'b' })
    expect(g.texts[0]).toBe('テラス')
    expect(g.texts).not.toContain('見えない所')
  })
})
