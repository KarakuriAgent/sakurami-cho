import { CABLE_TRACK_FROM } from '../../../core/cableStations'
import { SITE } from '../../../core/town'
import { GeoBuilder } from '../site/builder'
import { terrainHeight } from '../town/terrain'
import { LAMP, type Lamp } from '../town/lamps'
import { LIGHT_KIND, type LightItem } from '../town/lights'
import type { TownTile } from '../town/townData'
import { SignBuilder, signAtlas } from '../named/signs'
import { buildLandingGeometry, landingLights, type BoatLanding } from './landings'
import { TM, WireBatch } from './transitMaterial'
import { Path, RAIL_STRUCT, pathPoint, type PathPoint, type TownTransit } from './transitData'
import { placeTramPlatforms, TRAM_PLATFORM, trackOffset, tramPlatformBase, tramPlatformTop, type TramLine, type TramPlatform } from './trams'
import type { TrainFleet } from './trains'
import type { CableLine } from './cable'
import { WIRE_HEIGHT } from './vehicles'

/**
 * 交通の動かない物（線路・架線と架線柱・停留所・信号）と、街灯の柱（町の灯りの点に形を付ける）。
 *
 * - 細かさの中心から radius m までだけ形にする（作り直しは細かさの中心が動いたとき = relod）。遠くは画素より細かい
 * - ヒノテツの道床（砂利の帯）は町じゅう（安い）。枕木・レール・架線は近くだけ
 * - 緑電の線路は、系統と向きごとの線（trams.ts の trackOffset）に沿って引き、重なる所（系統が同じ道を走る所）は 1 本にする
 * - 停留所: 行きと帰りの線路の外側にホーム（長さ 32m・幅 2.6m・高さ 0.3m）と屋根・ベンチ・停留所の名前の標識・いまどこ表示・灯り
 * - 信号: 交差点の出ていく道ごとに、手前の左の角に柱と腕と横型の 3 灯（組ごとに青・黄・赤が入れ替わる。交差点ごとに位相をずらす）
 * - 街灯: タイルの灯り（街灯・提灯・足元灯・港の作業灯）の点に、柱と灯具の形（提灯は近い提灯どうしを綱でつなぐ）
 */

const LAB = SITE.labFloorElevation
const S = (x: number, y: number, z: number): [number, number, number] => [x, z - LAB, -y]
const GAUGE_TRAM = 1.435
const GAUGE_RAIL = 1.067
const RAIL_W = 0.07

const _p = pathPoint()
const _q = pathPoint()

/** 線の上の長さ d の、横に off m ずらした点（平面）と向き */
function offsetPoint(path: Path, d: number, off: number, out: PathPoint) {
  path.at(d, out)
  out.x -= out.dy * off
  out.y += out.dx * off
  return out
}

/** 1 本のレール（a → b の線の、横 lat m の所。上面の標高 top、高さ h） */
function rail(g: GeoBuilder, ax: number, ay: number, bx: number, by: number, az: number, bz: number, lat: number, h: number, color: string) {
  const dx = bx - ax
  const dy = by - ay
  const l = Math.hypot(dx, dy) || 1
  const nx = -dy / l
  const ny = dx / l
  const w = RAIL_W / 2
  const p = (x: number, y: number, s: number, z: number) => S(x + nx * (lat + s), y + ny * (lat + s), z)
  const a0 = p(ax, ay, -w, az)
  const a1 = p(ax, ay, w, az)
  const b0 = p(bx, by, -w, bz)
  const b1 = p(bx, by, w, bz)
  g.quad(a0, b0, b1, a1, color, TM.metal)
  g.quad(p(ax, ay, w, az), p(bx, by, w, bz), p(bx, by, w, bz - h), p(ax, ay, w, az - h), '#3b2e26', TM.dark, 0.2)
  g.quad(p(bx, by, -w, bz), p(ax, ay, -w, az), p(ax, ay, -w, az - h), p(bx, by, -w, bz - h), '#3b2e26', TM.dark, 0.2)
}

/** すでに引いた線路の点（1m の升）。近い所に引いてあれば重ねない */
class Dedupe {
  private cells = new Map<string, [number, number][]>()
  near(x: number, y: number, r: number) {
    const cx = Math.floor(x)
    const cy = Math.floor(y)
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) {
        const list = this.cells.get(`${cx + i},${cy + j}`)
        if (list) for (const [px, py] of list) if (Math.hypot(px - x, py - y) < r) return true
      }
    return false
  }
  add(x: number, y: number) {
    const k = `${Math.floor(x)},${Math.floor(y)}`
    const list = this.cells.get(k)
    if (list) list.push([x, y])
    else this.cells.set(k, [[x, y]])
  }
}

export interface InfraContext {
  trams: TramLine[]
  trains: TrainFleet | null
  cable: CableLine | null
  transit: TownTransit
  tiles: TownTile[]
  /** 形のある街灯に置き換えた灯り（ラボのまわりの小道。site/createSite.ts） */
  skipLight: (x: number, y: number, kind: number) => boolean
  /** 運河バスの乗り場 */
  landings: BoatLanding[]
}

/** 停留所の灯り・浮遊レーンの灯りなど、町の灯りの点と灯りの表に足す物（町じゅう。1 回だけ） */
export function transitLights(ctx: InfraContext) {
  const lights: LightItem[] = []
  const lamps: Lamp[] = []
  for (const st of stopPlacements(ctx)) {
    for (const pf of st.platforms) {
      const z = pf.z + 2.55
      lights.push({ x: pf.x, y: pf.y, z, kind: LIGHT_KIND.stop, color: '#ffe8cc', size: 0.5, power: 1.4, seed: 0.1 })
      lamps.push({ x: pf.x, y: pf.y, z, kind: LAMP.stop, power: 2.2 })
    }
  }
  const ll = landingLights(ctx.landings)
  lights.push(...ll.lights)
  lamps.push(...ll.lamps)
  return { lights, lamps }
}

type Platform = TramPlatform

/** 停留所のホームの置き方（trams.ts の placeTramPlatforms。1 回だけ作って覚える） */
const placementCache = new WeakMap<InfraContext, ReturnType<typeof placeTramPlatforms>>()
function stopPlacements(ctx: InfraContext) {
  let v = placementCache.get(ctx)
  if (!v) placementCache.set(ctx, (v = placeTramPlatforms(ctx.trams, ctx.transit.tramStops)))
  return v
}

type V3 = [number, number, number]

/**
 * 停留所の形（ホーム・屋根・ベンチ・標識・いまどこ表示）。標識の名前は看板のアトラスに描く。
 * ホームの面とスロープは線路の標高に沿い（坂の停留所で、車両の床と同じ傾き。trams.ts の tramPlatformBase）、下は両わきの地面より 0.4m 下まで
 * （谷の側で浮かない）。屋根・ベンチ・いまどこ表示・標識は水平で、高さは真ん中（標識は柱の所）の線路から。柱と脚はホームの面から伸ばす
 */
function buildStop(g: GeoBuilder, glass: GeoBuilder, signs: SignBuilder, pf: Platform, name: string, lines: number[]) {
  const L = TRAM_PLATFORM.length
  const W = TRAM_PLATFORM.width
  const H = TRAM_PLATFORM.height
  const ux = pf.dx
  const uy = pf.dy
  // 局所: a = 線に沿って、b = 線路から外へ（ホームの外側）
  const nx = -uy * pf.side
  const ny = ux * pf.side
  const base = (a: number) => tramPlatformBase(pf, a)
  const zc = base(0)
  const X = (a: number, b: number) => pf.x + ux * a + nx * b
  const Y = (a: number, b: number) => pf.y + uy * a + ny * b
  /** 局所の点（標高 z） */
  const Pz = (a: number, b: number, z: number) => S(X(a, b), Y(a, b), z)
  const yaw = Math.atan2(ux, -uy)
  /** 水平な箱（標高 z0〜z1）。GeoBuilder の箱は y 軸まわりの回転。局所 x = b 方向にそろえる */
  const boxZ = (a0: number, a1: number, b0: number, b1: number, z0: number, z1: number, color: string, mat: number, aux = 0) => {
    g.box(Pz((a0 + a1) / 2, (b0 + b1) / 2, (z0 + z1) / 2), [Math.abs(b1 - b0), z1 - z0, Math.abs(a1 - a0)], color, mat, aux, yaw)
  }
  /** 水平な箱（高さは真ん中の線路から h0〜h1） */
  const box = (a0: number, a1: number, b0: number, b1: number, h0: number, h1: number, color: string, mat: number, aux = 0) => boxZ(a0, a1, b0, b1, zc + h0, zc + h1, color, mat, aux)
  /** 外向き o（平面の向きと上。局所でなく町の向き）に表を向けた四角 */
  const face = (p: V3[], o: V3, color: string, mat: number, aux = 0) => {
    // 対角線の外積（p0 → p2 と p1 → p3）。表から見て反時計回りなら外を向く
    const d1 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]]
    const d2 = [p[3][0] - p[1][0], p[3][1] - p[1][1], p[3][2] - p[1][2]]
    const n = [d1[1] * d2[2] - d1[2] * d2[1], d1[2] * d2[0] - d1[0] * d2[2], d1[0] * d2[1] - d1[1] * d2[0]]
    const so = S(o[0], o[1], o[2] + LAB)
    if (n[0] * so[0] + n[1] * so[1] + n[2] * so[2] < 0) p = [p[3], p[2], p[1], p[0]]
    g.quad(p[0], p[1], p[2], p[3], color, mat, aux)
  }
  /** ホームに沿う板（a0〜a1・b0〜b1、上 top(a)・下 bot(a) の標高）: 上と両わき、ends の端 */
  const prism = (a0: number, a1: number, b0: number, b1: number, top: (a: number) => number, bot: (a: number) => number, color: string, mat: number, aux: number, ends: [boolean, boolean]) => {
    const as = [a0]
    for (let a = Math.floor(a0 + 1e-6) + 1; a < a1 - 1e-6; a++) as.push(a)
    as.push(a1)
    for (let i = 1; i < as.length; i++) {
      const a = as[i - 1]
      const c = as[i]
      face([Pz(a, b0, top(a)), Pz(c, b0, top(c)), Pz(c, b1, top(c)), Pz(a, b1, top(a))], [0, 0, 1], color, mat, aux)
      face([Pz(a, b1, bot(a)), Pz(c, b1, bot(c)), Pz(c, b1, top(c)), Pz(a, b1, top(a))], [nx, ny, 0], color, mat, aux)
      face([Pz(a, b0, bot(a)), Pz(c, b0, bot(c)), Pz(c, b0, top(c)), Pz(a, b0, top(a))], [-nx, -ny, 0], color, mat, aux)
    }
    if (ends[0]) face([Pz(a0, b0, bot(a0)), Pz(a0, b1, bot(a0)), Pz(a0, b1, top(a0)), Pz(a0, b0, top(a0))], [-ux, -uy, 0], color, mat, aux)
    if (ends[1]) face([Pz(a1, b0, bot(a1)), Pz(a1, b1, bot(a1)), Pz(a1, b1, top(a1)), Pz(a1, b0, top(a1))], [ux, uy, 0], color, mat, aux)
  }
  // ホーム（縁石の御影石・点字ブロックの黄色い帯・コンクリート）と端のスロープ。下は線路と両わきの地面の低い方の 0.4m 下
  const bottom = (a: number) => Math.min(base(a), terrainHeight(X(a, -W / 2), Y(a, -W / 2)), terrainHeight(X(a, W / 2), Y(a, W / 2))) - 0.4
  const top = (a: number) => tramPlatformTop(pf, a)
  prism(-L / 2, L / 2, -W / 2, W / 2, top, bottom, '#b9b4aa', TM.concrete, 1.2, [false, false])
  for (const s of [1, -1]) {
    const a0 = (s * L) / 2
    const a1 = a0 + s * TRAM_PLATFORM.ramp
    prism(Math.min(a0, a1), Math.max(a0, a1), -W / 2, W / 2, top, bottom, '#aaa59b', TM.concrete, 0, s > 0 ? [false, true] : [true, false])
  }
  prism(-L / 2, L / 2, -W / 2 + 0.25, -W / 2 + 0.55, (a) => base(a) + H + 0.015, (a) => base(a) + H, '#d8b41e', TM.paint, 0.2, [true, true])
  prism(-L / 2, L / 2, -W / 2, -W / 2 + 0.2, (a) => base(a) + H + 0.01, (a) => base(a) + H, '#d6d2c8', TM.stone, 0, [true, true])
  // 屋根（8m。緑の鉄骨・ガラスの背の壁・クリームの縁）。柱はホームの面から屋根まで
  const r0 = -5
  const r1 = 5
  for (const a of [r0 + 0.3, 0, r1 - 0.3]) {
    boxZ(a - 0.06, a + 0.06, W / 2 - 0.45, W / 2 - 0.33, base(a) + H, zc + 2.75, '#1f5a3e', TM.paint, 0.6)
  }
  box(r0, r1, -W / 2 + 0.15, W / 2 - 0.1, 2.75, 2.88, '#1f5a3e', TM.paint, 0.6)
  box(r0, r1, -W / 2 + 0.15, -W / 2 + 0.25, 2.62, 2.9, '#e9dfc4', TM.paint, 0.6)
  box(r0, r1, -W / 2 + 0.3, W / 2 - 0.2, 2.6, 2.62, '#fff2dc', TM.lamp, 1.6)
  // ガラスの背の壁（透けるガラス。両面）と、下の縁（ホームの面に沿う）・上の縁
  const ga = r0 + 0.4
  const gb = r1 - 0.4
  for (const s of [1, -1]) {
    const b = W / 2 - 0.36 + s * 0.012
    const q = [Pz(ga, b, base(ga) + 0.45), Pz(gb, b, base(gb) + 0.45), Pz(gb, b, zc + 2.5), Pz(ga, b, zc + 2.5)]
    if (s > 0) glass.quad(q[0], q[1], q[2], q[3], '#ffffff', TM.glass, 1)
    else glass.quad(q[1], q[0], q[3], q[2], '#ffffff', TM.glass, 1)
  }
  prism(r0 + 0.3, r1 - 0.3, W / 2 - 0.4, W / 2 - 0.32, (a) => base(a) + 0.45, (a) => base(a) + H, '#1f5a3e', TM.paint, 0.6, [true, true])
  box(r0 + 0.3, r1 - 0.3, W / 2 - 0.4, W / 2 - 0.32, 2.5, 2.6, '#1f5a3e', TM.paint, 0.6)
  // ベンチ（木の座面）。脚はホームの面から
  box(-3, 3, W / 2 - 0.85, W / 2 - 0.45, 0.72, 0.78, '#7a5232', TM.wood, 0.5)
  for (const a of [-2.6, 2.6]) boxZ(a - 0.05, a + 0.05, W / 2 - 0.8, W / 2 - 0.5, base(a) + H, zc + 0.72, '#2b2b2b', TM.dark, 0.4)
  // いまどこ表示（屋根の下に吊る）
  box(-0.75, 0.75, -0.05, 0.05, 2.15, 2.5, '#151515', TM.dark, 0.5)
  for (const s of [1, -1]) {
    const b = s * 0.052
    const q = [Pz(-0.7, b, zc + 2.18), Pz(0.7, b, zc + 2.18), Pz(0.7, b, zc + 2.47), Pz(-0.7, b, zc + 2.47)]
    if (s > 0) g.quad(q[0], q[1], q[2], q[3], '#111', TM.sign, -0.7)
    else g.quad(q[1], q[0], q[3], q[2], '#111', TM.sign, -0.7)
  }
  // 停留所の名前の標識（柱と板。系統の色の四角）。高さは柱の所の線路から
  const sa = r1 + 2.2
  const zs = base(sa)
  boxZ(sa - 0.05, sa + 0.05, 0.6, 0.7, zs + H, zs + 2.9, '#2b2b2b', TM.dark, 0.5)
  boxZ(sa - 0.55, sa + 0.55, 0.6, 0.7, zs + 2.2, zs + 2.85, '#f4f1ea', TM.paint, 0.4)
  lines.forEach((no, i) => boxZ(sa - 0.5 + i * 0.22, sa - 0.32 + i * 0.22, 0.58, 0.72, zs + 2.22, zs + 2.36, '#ffffff', TM.line, no))
  const r = signAtlas.region({ text: name, sub: `緑電 ${lines.join('・')}系統`, fg: '#1d3b2c', bg: '#f4f1ea', font: 'sans', bold: true, w: 1.1, h: 0.45 })
  for (const s of [1, -1]) {
    const b = s > 0 ? 0.705 : 0.595
    const pts = [Pz(sa - 0.53 * s, b, zs + 2.38), Pz(sa + 0.53 * s, b, zs + 2.38), Pz(sa + 0.53 * s, b, zs + 2.83), Pz(sa - 0.53 * s, b, zs + 2.83)]
    signs.quad(pts[0], pts[1], pts[2], pts[3], r, 1)
  }
}

/** 架線柱（中心の柱と両側の腕、または横の柱と片側の腕）と、架線の点 */
function tramCatenary(g: GeoBuilder, wires: WireBatch, line: TramLine, d0: number, d1: number, poles: Dedupe, wireDedupe: Dedupe) {
  const step = 30
  const tops: Record<number, [number, number, number][]> = { 1: [], [-1]: [] }
  // 柱は線の端から 4m と、そこから 30m ごと（終点の手前でも）
  const ds: number[] = []
  for (let d = 4 + Math.max(0, Math.ceil((d0 - 4) / step)) * step; d <= Math.min(d1, line.path.length - 4); d += step) ds.push(d)
  if (!line.data.loop && d1 >= line.path.length - 4 && (ds.length === 0 || line.path.length - 4 - ds[ds.length - 1] > 8)) ds.push(line.path.length - 4)
  for (const d of ds) {
    line.path.at(d, _p)
    const oo = trackOffset(line, d, 1)
    const ob = trackOffset(line, d, -1)
    const both = Math.abs(oo - ob) > 2.5
    const zig = ((Math.round(d / step) % 2) * 2 - 1) * 0.2
    for (const dir of [1, -1]) {
      const off = dir > 0 ? oo : ob
      if (!both && dir < 0) continue
      offsetPoint(line.path, d, off + zig, _q)
      tops[dir].push(S(_q.x, _q.y, _q.z + WIRE_HEIGHT))
    }
    // 柱は 1 回だけ（系統が重なる所）
    const pole = both ? 0 : Math.max(oo, ob) + 2.9
    offsetPoint(line.path, d, pole, _q)
    if (poles.near(_q.x, _q.y, 8)) continue
    poles.add(_q.x, _q.y)
    const gz = Math.min(_q.z, terrainHeight(_q.x, _q.y))
    const base = S(_q.x, _q.y, gz - 0.2)
    g.cylinder(base, 0.16, 0.6, 10, '#7f8079', TM.concrete, 0)
    g.cylinder(S(_q.x, _q.y, gz + 0.4), 0.11, _q.z - gz + 6.0, 10, '#4a4f4b', TM.paint, 0.4, true, 0.085)
    // 腕（線路の上まで）と碍子
    for (const dir of both ? [1, -1] : [1]) {
      const off = dir > 0 ? oo : ob
      offsetPoint(line.path, d, off, _p)
      const top = _q.z + 5.95
      g.beam(S(_q.x, _q.y, top), S(_p.x, _p.y, top), 0.07, '#4a4f4b', TM.paint, 0.4)
      g.beam(S(_q.x, _q.y, top - 0.6), S((_q.x + _p.x) / 2, (_q.y + _p.y) / 2, top), 0.05, '#4a4f4b', TM.paint, 0.4)
      g.box(S(_p.x, _p.y, top - 0.25), [0.08, 0.4, 0.08], '#7a5b3c', TM.dark, 0.6)
    }
  }
  for (const dir of [1, -1]) {
    const t = tops[dir]
    for (let i = 1; i < t.length; i++) {
      const mx = (t[i][0] + t[i - 1][0]) / 2
      const mz = (t[i][2] + t[i - 1][2]) / 2
      if (wireDedupe.near(mx, -mz, 1.0)) continue
      wireDedupe.add(mx, -mz)
      wires.seg(t[i - 1], t[i], 0.014)
    }
  }
}

/** 信号（交差点の出ていく道ごと） */
function buildSignals(g: GeoBuilder, transit: TownTransit, center: [number, number], radius: number) {
  for (const sgl of transit.signals) {
    if (Math.hypot(sgl.x - center[0], sgl.y - center[1]) > radius) continue
    const axis0 = sgl.dirs[0].a
    const phase = Math.floor((((Math.sin(sgl.x * 12.9898 + sgl.y * 78.233) * 43758.5453) % 1) + 1) % 1 * 80)
    for (const dir of sgl.dirs) {
      const group = Math.abs(Math.cos(dir.a - axis0)) > 0.7 ? 0 : 1
      const ux = Math.cos(dir.a)
      const uy = Math.sin(dir.a)
      // 入ってくる車から見て左の角（車は左側を走る）: 道の左の縁の外
      const nx = uy
      const ny = -ux
      const hw = dir.w / 2
      const px = sgl.x + ux * (hw + 2.0) + nx * (hw + 0.8)
      const py = sgl.y + uy * (hw + 2.0) + ny * (hw + 0.8)
      const gz = terrainHeight(px, py)
      g.cylinder(S(px, py, gz), 0.1, 5.6, 8, '#6f7270', TM.metal, 0, true, 0.08)
      // 腕（道の上へ 3.5m）
      const ax = px - nx * 3.6
      const ay = py - ny * 3.6
      g.beam(S(px, py, gz + 5.3), S(ax, ay, gz + 5.3), 0.09, '#6f7270', TM.metal)
      // 横型の 3 灯の箱（入ってくる車の方 = +u を向く）
      const yaw = Math.atan2(ux, -uy)
      const hx = ax + nx * 0.2
      const hy = ay + ny * 0.2
      g.box(S(hx, hy, gz + 5.3), [1.25, 0.42, 0.3], '#2a2c2e', TM.dark, 0.3, yaw)
      ;[2, 1, 0].forEach((c, i) => {
        // 左から 青・黄・赤（日本の横型）
        const o = (i - 1) * 0.4
        const lx = hx - nx * o + ux * 0.16
        const ly = hy - ny * o + uy * 0.16
        g.box(S(lx, ly, gz + 5.3), [0.3, 0.3, 0.04], '#222', TM.signal, c + 4 * group + 8 * phase, yaw)
        // ひさし
        g.box(S(lx + ux * 0.1, ly + uy * 0.1, gz + 5.48), [0.32, 0.03, 0.2], '#2a2c2e', TM.dark, 0.3, yaw)
      })
    }
  }
}

/** 街灯の柱と灯具（タイルの灯りの点から） */
function buildLampPosts(g: GeoBuilder, wires: WireBatch, ctx: InfraContext, center: [number, number], radius: number) {
  const lanterns: [number, number, number][] = []
  for (const t of ctx.tiles) {
    const [bx0, by0, bx1, by1] = t.meta.bounds
    if (bx1 < center[0] - radius || bx0 > center[0] + radius || by1 < center[1] - radius || by0 > center[1] + radius) continue
    const lp = t.sections.l_pos.array as Float32Array
    const lc = t.sections.l_col.array as Uint8Array
    const lk = t.sections.l_kind.array as Uint8Array
    for (let k = 0; k < lp.length / 4; k++) {
      const x = lp[k * 4]
      const y = lp[k * 4 + 1]
      const z = lp[k * 4 + 2]
      const kind = lk[k * 2]
      if (kind !== LIGHT_KIND.street && kind !== LIGHT_KIND.path && kind !== LIGHT_KIND.port) continue
      if (Math.hypot(x - center[0], y - center[1]) > radius) continue
      if (ctx.skipLight(x, y, kind)) continue
      const gz = terrainHeight(x, y)
      const h = z - gz
      const lantern = kind === LIGHT_KIND.path && lc[k * 4] > 250 && lc[k * 4 + 1] < 170
      if (kind === LIGHT_KIND.port) {
        // 港の作業灯の高い柱（20m）と、4 つの投光器
        g.cylinder(S(x, y, gz), 0.28, h, 8, '#8d918f', TM.metal, 0, true, 0.18)
        g.box(S(x, y, z - 0.35), [2.3, 0.12, 0.5], '#5d605e', TM.metal)
        for (const s of [-0.75, -0.25, 0.25, 0.75]) g.box(S(x + s, y, z + 0.1), [0.42, 0.32, 0.3], '#fff2dc', TM.lamp, 2.5)
      } else if (lantern) {
        lanterns.push([x, y, z])
        // 提灯（赤い紙・黒い上下のふた）
        g.cylinder(S(x, y, z - 0.25), 0.17, 0.5, 10, '#e0582a', TM.lamp, 1.7, false)
        g.cylinder(S(x, y, z - 0.29), 0.12, 0.05, 10, '#1c1c1c', TM.dark, 0.3, true)
        g.cylinder(S(x, y, z + 0.25), 0.12, 0.05, 10, '#1c1c1c', TM.dark, 0.3, true)
      } else if (h < 1.5) {
        // 足元灯
        g.cylinder(S(x, y, gz), 0.08, h, 8, '#3a3836', TM.paint, 0.4, true)
        g.box(S(x, y, z), [0.14, 0.12, 0.14], '#ffd9a0', TM.lamp, 1.6)
      } else {
        // 街灯: 濃い緑の鋳鉄風の柱と、ランタン形の灯具
        g.cylinder(S(x, y, gz), 0.13, 0.5, 10, '#1f2b26', TM.paint, 0.5, true, 0.1)
        g.cylinder(S(x, y, gz + 0.5), 0.065, h - 0.9, 8, '#1f2b26', TM.paint, 0.5, false, 0.05)
        g.box(S(x, y, z - 0.42), [0.22, 0.06, 0.22], '#1f2b26', TM.paint, 0.5)
        g.cylinder(S(x, y, z - 0.39), 0.15, 0.55, 8, '#ffe2b0', TM.lamp, 2.6, false, 0.19)
        g.cylinder(S(x, y, z + 0.16), 0.22, 0.12, 8, '#1f2b26', TM.paint, 0.5, true, 0.05)
      }
    }
  }
  // 提灯どうしを綱でつなぐ（12m 以内の近いものと。少したるませる）
  const seen = new Set<string>()
  lanterns.forEach((a, i) => {
    let best = -1
    let bd = 12
    lanterns.forEach((b, j) => {
      if (j === i) return
      const d = Math.hypot(a[0] - b[0], a[1] - b[1])
      if (d < bd && !seen.has(`${j},${i}`)) {
        bd = d
        best = j
      }
    })
    if (best < 0) return
    seen.add(`${i},${best}`)
    const b = lanterns[best]
    const mid: [number, number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2 + 0.15]
    wires.seg(S(a[0], a[1], a[2] + 0.3), S(mid[0], mid[1], mid[2] + 0.3), 0.008)
    wires.seg(S(mid[0], mid[1], mid[2] + 0.3), S(b[0], b[1], b[2] + 0.3), 0.008)
  })
}

/** ヒノテツの道床（砂利の帯）。町じゅう、線路の向きごと */
export function railBallast(trains: TrainFleet) {
  const g = new GeoBuilder()
  const path = trains.path
  const L = path.length
  for (const dir of [1, -1]) {
    let prev: [number, number, number, number] | null = null
    for (let d = 0; d <= L; d += 6) {
      const i = path.index(d)
      const tag = path.tag[i]
      if (tag === RAIL_STRUCT.tunnel || tag === RAIL_STRUCT.cutting) {
        prev = null
        continue
      }
      const off = trains.offset(d, dir)
      offsetPoint(path, d, off, _p)
      const cur: [number, number, number, number] = [_p.x, _p.y, _p.z, Math.atan2(_p.dy, _p.dx)]
      if (prev) {
        const [ax, ay, az] = prev
        const [bx, by, bz] = cur
        const dx = bx - ax
        const dy = by - ay
        const l = Math.hypot(dx, dy) || 1
        const nx = -dy / l
        const ny = dx / l
        const w = 1.5
        const zt = (z: number) => z - 0.22
        g.quad(S(ax - nx * w, ay - ny * w, zt(az)), S(bx - nx * w, by - ny * w, zt(bz)), S(bx + nx * w, by + ny * w, zt(bz)), S(ax + nx * w, ay + ny * w, zt(az)), '#6c655d', TM.stone)
        for (const s of [1, -1]) g.quad(S(ax + nx * w * s, ay + ny * w * s, zt(az)), S(bx + nx * w * s, by + ny * w * s, zt(bz)), S(bx + nx * (w + 0.5) * s, by + ny * (w + 0.5) * s, zt(bz) - 0.45), S(ax + nx * (w + 0.5) * s, ay + ny * (w + 0.5) * s, zt(az) - 0.45), '#5f5852', TM.stone)
        // 桜見の 2 番線から高架へ移る所: 下りの線路が高架の幅（線の中心から 5.5m）の外を通る区間は、煉瓦の床版と柱で高架を広げる
        const elevated = tag === RAIL_STRUCT.stoneArch || tag === RAIL_STRUCT.concreteViaduct || tag === RAIL_STRUCT.bridge
        if (dir > 0 && elevated && Math.abs(off) > 4.2) {
          const mx = (ax + bx) / 2 - nx * 0.6 * Math.sign(off)
          const my = (ay + by) / 2 - ny * 0.6 * Math.sign(off)
          const mz = (az + bz) / 2
          const yaw = Math.atan2(dx, -dy)
          g.box(S(mx, my, mz - 0.85), [4.4, 1.1, l + 0.2], '#7d4c3a', TM.concrete, 0, yaw)
          g.box(S(mx + nx * 2.1 * Math.sign(off), my + ny * 2.1 * Math.sign(off), mz + 0.3), [0.35, 1.2, l + 0.2], '#8a5a44', TM.concrete, 0, yaw)
          if (Math.round(d) % 12 === 0) {
            const gz = terrainHeight(mx, my)
            if (mz - 1.4 - gz > 0.5) g.box(S(mx, my, (mz - 1.4 + gz - 1) / 2), [2.2, mz - 1.4 - gz + 1, 1.6], '#7d4c3a', TM.concrete, 0, yaw)
          }
        }
      }
      prev = cur
    }
  }
  return g
}

/** 近くの動かない物を作る（細かさの中心 center から radius m まで） */
export function buildTransitInfra(ctx: InfraContext, center: [number, number], radius: number) {
  const it = buildTransitInfraSteps(ctx, center, radius)
  for (;;) {
    const r = it.next()
    if (r.done) return r.value
  }
}

/** 作る手順（系統・停留所・線路ごとに yield。町の中を歩く間は 1 コマに少しずつ。§7 の 152）。最後に形を返す */
export function* buildTransitInfraSteps(ctx: InfraContext, center: [number, number], radius: number): Generator<void, ReturnType<typeof finishInfra>> {
  const g = new GeoBuilder()
  const glass = new GeoBuilder()
  const wires = new WireBatch()
  const signs = new SignBuilder()
  const inR = (x: number, y: number, extra = 0) => Math.hypot(x - center[0], y - center[1]) < radius + extra
  // 緑電の線路
  const drawn = new Dedupe()
  const poles = new Dedupe()
  const wireDd = new Dedupe()
  for (const line of ctx.trams) {
    const L = line.path.length
    for (const dir of [1, -1]) {
      let prev: [number, number, number] | null = null
      let runFrom = -1
      for (let d = 0; d <= L; d += 2) {
        line.path.at(d, _p)
        if (!inR(_p.x, _p.y)) {
          prev = null
          if (runFrom >= 0) {
            if (dir > 0) tramCatenary(g, wires, line, runFrom, d, poles, wireDd)
            runFrom = -1
          }
          continue
        }
        if (runFrom < 0) runFrom = d
        const off = trackOffset(line, d, dir)
        offsetPoint(line.path, d, off, _q)
        const cur: [number, number, number] = [_q.x, _q.y, _q.z]
        if (prev) {
          const mx = (prev[0] + cur[0]) / 2
          const my = (prev[1] + cur[1]) / 2
          if (!drawn.near(mx, my, 0.7)) {
            for (const s of [-1, 1]) rail(g, prev[0], prev[1], cur[0], cur[1], prev[2] + 0.025, cur[2] + 0.025, (s * GAUGE_TRAM) / 2, 0.07, '#9a9a96')
          }
        }
        if (prev) drawn.add((prev[0] + cur[0]) / 2, (prev[1] + cur[1]) / 2)
        prev = cur
      }
      if (runFrom >= 0 && dir > 0) tramCatenary(g, wires, line, runFrom, L, poles, wireDd)
    }
    yield
  }
  // 停留所
  for (const st of stopPlacements(ctx)) for (const pf of st.platforms) if (inR(pf.x, pf.y)) buildStop(g, glass, signs, pf, st.name, st.lines)
  // 運河バスの乗り場（岸の石段と下の段・桟橋の乗船の段。landings.ts）
  for (const l of ctx.landings) if (inR(l.ex, l.ey)) buildLandingGeometry(g, signs, l)
  yield
  // ヒノテツ: 枕木・レール・架線柱・架線
  if (ctx.trains) {
    const tr = ctx.trains
    const path = tr.path
    const L = path.length
    for (const dir of [1, -1]) {
      let prev: [number, number, number] | null = null
      const tops: [number, number, number][] = []
      for (let d = 0; d <= L; d += 3) {
        path.at(d, _p)
        const tag = path.tag[path.index(d)]
        if (!inR(_p.x, _p.y) || tag === RAIL_STRUCT.tunnel) {
          prev = null
          continue
        }
        const off = tr.offset(d, dir)
        offsetPoint(path, d, off, _q)
        const cur: [number, number, number] = [_q.x, _q.y, _q.z]
        if (prev) for (const s of [-1, 1]) rail(g, prev[0], prev[1], cur[0], cur[1], prev[2], cur[2], (s * GAUGE_RAIL) / 2, 0.16, '#a3a29d')
        // 枕木（0.6m ごと = 3m に 5 本）
        if (prev) {
          const yaw = Math.atan2(_q.dx, -_q.dy)
          for (let k = 0; k < 5; k++) {
            const t = k / 5
            g.box(S(prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t, prev[2] + (cur[2] - prev[2]) * t - 0.2), [2.0, 0.12, 0.22], '#4f4842', TM.concrete, 0, yaw)
          }
        }
        // 架線柱（50m ごと。線路の外側の柱と腕）
        if (Math.round(d) % 48 === 0) {
          const side = dir > 0 ? 1 : -1
          offsetPoint(path, d, off + side * 2.6, _p)
          const onDeck = tag === RAIL_STRUCT.concreteViaduct || tag === RAIL_STRUCT.stoneArch || tag === RAIL_STRUCT.bridge
          const gz = onDeck ? _q.z - 0.3 : Math.min(_q.z - 0.3, terrainHeight(_p.x, _p.y))
          g.box(S(_p.x, _p.y, (gz + _q.z + 7.2) / 2), [0.3, _q.z + 7.2 - gz, 0.3], '#9da09c', TM.concrete, 0, Math.atan2(_q.dx, -_q.dy))
          g.beam(S(_p.x, _p.y, _q.z + 6.6), S(_q.x, _q.y, _q.z + 6.6), 0.1, '#7d807c', TM.metal)
          tops.push(S(_q.x, _q.y, _q.z + 5.1))
        }
        prev = cur
      }
      for (let i = 1; i < tops.length; i++) {
        if (Math.hypot(tops[i][0] - tops[i - 1][0], tops[i][2] - tops[i - 1][2]) > 60) continue
        wires.seg(tops[i - 1], tops[i], 0.014)
        wires.seg([tops[i - 1][0], tops[i - 1][1] + 1.2, tops[i - 1][2]], [tops[i][0], tops[i][1] + 1.2, tops[i][2]], 0.012)
      }
      yield
    }
  }
  // ケーブル: レール・枕木・綱。楓坂駅の前後の行き違い線は 2 本（本線から左右へ分かれる。§7 の 178）
  if (ctx.cable) {
    const line = ctx.cable
    const L = line.length
    const tracks = [0, 1, -1]
    const prev: ([number, number, number] | null)[] = [null, null, null]
    const _t = { x: 0, y: 0, z: 0, dx: 0, dy: 0, grade: 0 }
    for (let d = 0; d <= L; d += 2) {
      const u = L - d
      const w = line.loopWeight(u)
      for (let k = 0; k < tracks.length; k++) {
        const side = tracks[k]
        // 本線（行き違い線の外）・行き違い線の 2 本（分かれ目から）
        // 麓駅の車止めより下（ふもとの道の上）は描かない（D-055）
        const on = (side === 0 ? w < 0.999 : w > 0.001) && u > CABLE_TRACK_FROM
        line.track(u, side * line.loopOff * w, _t)
        if (!on || !inR(_t.x, _t.y)) {
          prev[k] = null
          continue
        }
        const cur: [number, number, number] = [_t.x, _t.y, _t.z]
        const p0 = prev[k]
        if (p0) {
          for (const s of [-1, 1]) rail(g, p0[0], p0[1], cur[0], cur[1], p0[2], cur[2], (s * GAUGE_RAIL) / 2, 0.14, '#9a9893')
          g.box(S((p0[0] + cur[0]) / 2, (p0[1] + cur[1]) / 2, (p0[2] + cur[2]) / 2 - 0.15), [1.9, 0.12, 0.2], '#5a5149', TM.wood, 0.3, Math.atan2(_t.dx, -_t.dy))
          wires.seg(S(p0[0], p0[1], p0[2] + 0.12), S(cur[0], cur[1], cur[2] + 0.12), 0.035)
        }
        prev[k] = cur
      }
    }
  }
  yield
  buildSignals(g, ctx.transit, center, radius)
  yield
  buildLampPosts(g, wires, ctx, center, Math.min(radius * 0.65, 600))
  yield
  return finishInfra(g, glass, wires, signs)
}

function finishInfra(g: GeoBuilder, glass: GeoBuilder, wires: WireBatch, signs: SignBuilder) {
  signAtlas.flush()
  return { geometry: g.build(), glass: glass.build(), wires: wires.build(), signs: signs.build() }
}

