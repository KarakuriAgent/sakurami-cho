import { SITE } from '../../../core/town'
import type { ExtraSurface } from '../../walk/townWalk'
import { GeoBuilder } from '../site/builder'
import { SignBuilder, signAtlas } from '../named/signs'
import { LAMP, type Lamp } from '../town/lamps'
import { LIGHT_KIND, type LightItem } from '../town/lights'
import type { TownInfra } from '../town/townData'
import { TM } from './transitMaterial'
import { Path, pathPoint, type TownTransit } from './transitData'
import { WATERBUS } from './waterbusCar'

/**
 * 運河バスの乗り場（docs/design/town.md §20・§7 の 196〜）: 岸から水面へ降りる石段（町の地図データの船着き場 landing。D-036「岸から水面へ降りる石段」
 * `steps` = (岸の高さ − 0.3m) ÷ 0.18m）と、下の段（舟に乗り降りする乗り場）。港の浮き桟橋（赤レンガ・ソラノワ・汐見フェリーターミナル・汐見明神浜）は、
 * 桟橋の長い側の縁に同じ形の乗船の段を付ける（データの桟橋の天端は 1.8〜2.4m で、舟の甲板 0.55m と段で結ぶ）。
 *
 * 形: 岸の線に沿って、水の側へ幅 1.5m の石段を下ろす（上の踊り場 → 段 → 下の段（水面 + 0.35m・長さ 3.2m））。下の段の水の側に係留の柱と防舷材、
 * 石段の水の側に鉄の手すり。上の踊り場の陸の側に「運河バス のりば」の札と灯り。岸のすぐ内の地形の格子の下がり（1m の刻み）は、上の踊り場の
 * 陸の側の敷石（エプロン）が覆う。舟は下の段に横付けする（boats.ts の berth）。花音は上の踊り場から段を下り、下の段で舟を待つ（character/ride/boatRide.ts）。
 *
 * 局所の座標: a = 岸に沿う向き u、b = 岸から水へ w（岸の線 = 0）。
 */

const LAB = SITE.labFloorElevation

export const LANDING = {
  /** 石段と下の段の幅（岸から水へ） */
  width: 1.5,
  /** 下の段の長さと、水面からの高さ */
  stage: 3.2,
  stageZ: 0.35,
  /** 上の踊り場の長さ・陸の側の敷石の奥行き */
  top: 1.2,
  apron: 1.6,
  tread: 0.3,
  /** 舟の外板と下の段の縁のすき間 */
  gap: 0.12,
} as const

export interface BoatLanding {
  /** 乗り場（航路の停留所）の id（waterbus_pier.*）と名前 */
  id: string
  name: string
  /** 岸の石段の船着き場 / 港の桟橋の乗船の段 */
  kind: 'landing' | 'pier'
  /** 岸の線の上の点（平面座標）・岸に沿う向き u・水へ向く向き w（単位ベクトル） */
  ex: number
  ey: number
  ux: number
  uy: number
  wx: number
  wy: number
  /** 岸の上・水面の標高（m） */
  top: number
  water: number
  steps: number
  rise: number
  /** 下の段の水の側の縁（岸の線からの b）。石段の幅 1.5m より広いことがある（舟の外板が岸・浅い所にかからない所まで出す） */
  stageW: number
  /** 下の段の真ん中（a）・石段の上る向き（+1 = +u へ上る）・石段の長さ */
  aS: number
  sgn: 1 | -1
  stairLen: number
  /** 航路（A・B・C） */
  routes: string[]
}

/** 局所 (a, b) → 平面座標 */
export function landingPoint(l: BoatLanding, a: number, b: number): [number, number] {
  return [l.ex + l.ux * a + l.wx * b, l.ey + l.uy * a + l.wy * b]
}

/** 下の段の上の標高 */
export const stageTop = (l: BoatLanding) => l.water + LANDING.stageZ

/** 上の踊り場の真ん中の a */
export const topA = (l: BoatLanding) => l.aS + l.sgn * (LANDING.stage / 2 + l.stairLen + LANDING.top / 2)

/**
 * 局所の a の標高（石段の上。step = 段のまま）。r = 下の段の真ん中からの、上る向きの長さ
 */
export function landingZ(l: BoatLanding, a: number, step: boolean) {
  const r = (a - l.aS) * l.sgn
  const s0 = LANDING.stage / 2
  const base = stageTop(l)
  if (r <= s0) return base
  const k = (r - s0) / LANDING.tread
  if (k >= l.steps) return l.top
  if (step) return base + Math.min(l.steps, Math.floor(k) + 1) * l.rise
  // 体の高さ用: 段の鼻を結ぶ坂
  return base + Math.min(l.steps, k + 0.5) * l.rise
}

/** 乗り場（町の地図データの船着き場・桟橋）を、航路の停留所から作る（1 回）。infra.walls（運河の岸・岸壁・桟橋の縁）と標高の関数を使う */
export function buildLandings(infra: TownInfra, transit: TownTransit, heightAt: (x: number, y: number) => number, waterAt: (x: number, y: number) => number): BoatLanding[] {
  const out: BoatLanding[] = []
  const byId = new Map<string, BoatLanding>()
  const p = pathPoint()
  for (const r of transit.waterbus) {
    const path = new Path(r.pts, 3, false)
    for (const s of r.stops) {
      if (!s.id.startsWith('waterbus_pier.') && !s.id.startsWith('ferry_pier.')) continue
      const have = byId.get(s.id)
      if (have) {
        if (!have.routes.includes(r.route)) have.routes.push(r.route)
        continue
      }
      path.at(s.d, p)
      const S: [number, number] = [p.x, p.y]
      const water = p.z
      const key = s.id.replace('waterbus_pier.', '')
      const ld = transit.landings.find((l) => l.id === `landing.${key}`)
      let e: { ex: number; ey: number; ux: number; uy: number; wx: number; wy: number; top: number; kind: BoatLanding['kind'] } | null = null
      if (ld) {
        // 岸の石段の船着き場: 点は岸の縁（水へ向く向きは bearing）。運河の岸壁（infra.walls）が近くにあれば、その線を岸の線にする（天端 = 岸の高さ）。
        // 無ければ川の岸（地形の段）: 点を岸の線、岸の上の標高は 1〜3m 陸の側のいちばん高い所
        const b = (ld.bearing * Math.PI) / 180
        let wx = Math.sin(b)
        let wy = Math.cos(b)
        // 岸壁は点のすぐ近く（3m）で、水へ向く向きとほぼ直角に走るものだけ（川と運河の合流の所などで、別の岸の線を拾わないように）
        const near = nearestWall(infra, ld.x, ld.y, 3, (k) => k === 'canal' || k === 'quay' || k === 'seawall')
        const wall = near && Math.abs(near.ux * wx + near.uy * wy) < 0.5 ? near : null
        if (wall) {
          const ux = wall.ux
          const uy = wall.uy
          // 水の向き: 壁の法線のうち、停留所の点の側
          let nx = -uy
          let ny = ux
          if ((S[0] - wall.px) * nx + (S[1] - wall.py) * ny < 0) {
            nx = -nx
            ny = -ny
          }
          wx = nx
          wy = ny
          e = { ex: wall.px, ey: wall.py, ux: wy, uy: -wx, wx, wy, top: Math.max(wall.top ?? 0, heightAt(wall.px - wx * 1.6, wall.py - wy * 1.6)), kind: 'landing' }
        } else {
          // 点が水の上（川と運河の合流の所など。桜見川合流は 23m）なら、陸の側へ戻って岸を探す（30m まで）
          let ex = ld.x
          let ey = ld.y
          if (waterAt(ex, ey) !== 0)
            for (let d = 0.5; d <= 30; d += 0.5)
              if (waterAt(ld.x - wx * d, ld.y - wy * d) === 0) {
                ex = ld.x - wx * (d - 0.25)
                ey = ld.y - wy * (d - 0.25)
                break
              }
          let top = -Infinity
          for (const d of [1, 1.6, 2.2, 3]) top = Math.max(top, heightAt(ex - wx * d, ey - wy * d))
          e = { ex, ey, ux: wy, uy: -wx, wx, wy, top, kind: 'landing' }
        }
      } else {
        // 港の桟橋: いちばん近い岸壁・桟橋の縁のうち、乗船の段が入る長さで、外が水の辺
        let best: { d: number; ax: number; ay: number; bx: number; by: number; top: number } | null = null
        for (const w of infra.walls) {
          if (w.kind !== 'quay') continue
          for (let i = 1; i < w.pts.length; i++) {
            const [ax, ay] = w.pts[i - 1]
            const [bx, by] = w.pts[i]
            const len = Math.hypot(bx - ax, by - ay)
            if (len < LANDING.stage + 8) continue
            const t = Math.max(0, Math.min(1, ((S[0] - ax) * (bx - ax) + (S[1] - ay) * (by - ay)) / (len * len)))
            const d = Math.hypot(ax + (bx - ax) * t - S[0], ay + (by - ay) * t - S[1])
            if (d < 30 && (!best || d < best.d)) best = { d, ax, ay, bx, by, top: w.top ?? 2 }
          }
        }
        if (best) {
          const len = Math.hypot(best.bx - best.ax, best.by - best.ay)
          const ux = (best.bx - best.ax) / len
          const uy = (best.by - best.ay) / len
          // 外（水）の向き: 法線の両方を水で確かめる
          let wx = -uy
          let wy = ux
          const mx = (best.ax + best.bx) / 2
          const my = (best.ay + best.by) / 2
          if (waterAt(mx + wx * 4, my + wy * 4) === 0 && waterAt(mx - wx * 4, my - wy * 4) !== 0) {
            wx = -wx
            wy = -wy
          }
          // 停留所の点を辺に投げた所（端から 4m より内）
          const ta = Math.max(4, Math.min(len - 4, (S[0] - best.ax) * ux + (S[1] - best.ay) * uy))
          e = { ex: best.ax + ux * ta, ey: best.ay + uy * ta, ux, uy, wx, wy, top: best.top, kind: 'pier' }
        }
      }
      if (!e) continue
      const H = e.top - water
      if (H < LANDING.stageZ + 0.2) continue
      const steps = Math.max(2, Math.round((H - LANDING.stageZ) / 0.18))
      const rise = (H - LANDING.stageZ) / steps
      const stairLen = steps * LANDING.tread
      // 下の段の真ん中: 舟が止まる所（停留所の点）を岸の線に投げた所。石段は、岸が長く続く向きへ上る（運河の角・橋を避ける）
      const aS = (S[0] - e.ex) * e.ux + (S[1] - e.ey) * e.uy
      const need = LANDING.stage / 2 + stairLen + LANDING.top + 1
      const run = (sgn: number) => {
        // 岸に沿って need m 先まで、岸の内（b = -0.6）が陸で、外（b = 2.5）が水か
        let ok = 0
        for (let a = 0; a <= need; a += 1) {
          const x = e!.ex + e!.ux * (aS + sgn * a)
          const y = e!.ey + e!.uy * (aS + sgn * a)
          if (waterAt(x - e!.wx * 0.8, y - e!.wy * 0.8) === 0 && waterAt(x + e!.wx * 2.5, y + e!.wy * 2.5) !== 0) ok++
        }
        return ok
      }
      const sgn: 1 | -1 = run(1) >= run(-1) ? 1 : -1
      // 下の段の縁: 横付けした舟（どちらの向きでも）の船体が、陸・岸の地形にかからない所まで水の側へ出す（1.5〜4.5m。川と運河の合流の所など）
      const clear = (W: number) => {
        for (const f of [1, -1]) {
          const ca = aS - f * WATERBUS.doorZ
          const cb = W + LANDING.gap + WATERBUS.beam / 2
          for (let zz = -WATERBUS.length / 2 + 0.6; zz <= WATERBUS.length / 2 - 0.6; zz += 1.2)
            for (const xx of [-WATERBUS.beam / 2 + 0.1, 0, WATERBUS.beam / 2 - 0.1]) {
              const a = ca + f * zz
              const b = cb + xx
              if (waterAt(e!.ex + e!.ux * a + e!.wx * b, e!.ey + e!.uy * a + e!.wy * b) === 0) return false
            }
        }
        return true
      }
      let stageW: number = LANDING.width
      while (stageW < 4.5 && !clear(stageW)) stageW += 0.25
      const l: BoatLanding = { id: s.id, name: s.name, ...e, water, steps, rise, aS, sgn, stairLen, stageW, routes: [r.route] }
      out.push(l)
      byId.set(s.id, l)
    }
  }
  return out
}

/** いちばん近い岸壁・運河の岸の線分（点 x, y から r m まで）。投げた点・沿う向き・天端 */
function nearestWall(infra: TownInfra, x: number, y: number, r: number, kind: (k: string) => boolean) {
  let best: { d: number; px: number; py: number; ux: number; uy: number; top?: number } | null = null
  for (const w of infra.walls) {
    if (!kind(w.kind)) continue
    for (let i = 1; i < w.pts.length; i++) {
      const [ax, ay] = w.pts[i - 1]
      const [bx, by] = w.pts[i]
      const len = Math.hypot(bx - ax, by - ay)
      if (len < 0.5) continue
      const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (len * len)))
      const px = ax + (bx - ax) * t
      const py = ay + (by - ay) * t
      const d = Math.hypot(px - x, py - y)
      if (d < r && (!best || d < best.d)) best = { d, px, py, ux: (bx - ax) / len, uy: (by - ay) / len, top: w.top }
    }
  }
  return best
}

/** 乗り場の歩ける面（石段と下の段・上の踊り場の陸の側の敷石） */
export function landingSurfaces(list: BoatLanding[]): ExtraSurface[] {
  const out: ExtraSurface[] = []
  for (const l of list) {
    // 石段と上の踊り場（幅 1.5m）
    const a0 = l.aS + l.sgn * (LANDING.stage / 2)
    const a1 = l.aS + l.sgn * (LANDING.stage / 2 + l.stairLen + LANDING.top)
    const ac = (a0 + a1) / 2
    const [cx, cy] = landingPoint(l, ac, LANDING.width / 2)
    out.push({
      x: cx,
      y: cy,
      ux: l.ux,
      uy: l.uy,
      halfL: Math.abs(a1 - a0) / 2,
      halfW: LANDING.width / 2,
      z: (a, step) => landingZ(l, a + ac, step),
      stairs: { rise: l.rise, tread: LANDING.tread, up: l.sgn, from: a0 - ac, to: l.aS + l.sgn * (LANDING.stage / 2 + l.stairLen) - ac },
    })
    // 下の段（水の側の縁まで）
    const [sx, sy] = landingPoint(l, l.aS, l.stageW / 2)
    out.push({ x: sx, y: sy, ux: l.ux, uy: l.uy, halfL: LANDING.stage / 2, halfW: l.stageW / 2, z: () => stageTop(l) })
    // 陸の側の敷石（上の踊り場の真ん中の前後 1.2m・岸から 1.6m 内まで。岸の縁の地形の下がりを覆う）
    const ta = topA(l)
    const [px, py] = landingPoint(l, ta, -LANDING.apron / 2)
    out.push({ x: px, y: py, ux: l.ux, uy: l.uy, halfL: LANDING.top / 2 + 0.6, halfW: LANDING.apron / 2, z: () => l.top })
  }
  return out
}

/** 乗り場の灯り（上の踊り場の札の柱の灯り。夜の灯りの表と灯りの点） */
export function landingLights(list: BoatLanding[]) {
  const lights: LightItem[] = []
  const lamps: Lamp[] = []
  for (const l of list) {
    const [x, y] = landingPoint(l, topA(l) + l.sgn * 0.9, -0.55)
    lights.push({ x, y, z: l.top + 2.3, kind: LIGHT_KIND.stop, color: '#ffe2bb', size: 0.35, power: 1.1, seed: 0.2 })
    lamps.push({ x, y, z: l.top + 2.3, kind: LAMP.stop, power: 1.6 })
  }
  return { lights, lamps }
}

const STONE = '#a9a59b'
const STONE_D = '#8f8b82'
const IRON = '#26292b'

/** 乗り場の形（近くだけ。細かさの中心から radius m まで）。g = 交通の不透明な形、signs = 看板の字 */
export function buildLandingGeometry(g: GeoBuilder, signs: SignBuilder, l: BoatLanding) {
  const S = (a: number, b: number, z: number): [number, number, number] => {
    const [x, y] = landingPoint(l, a, b)
    return [x, z - LAB, -y]
  }
  // 箱の局所の z を岸に沿う向き u に（局所の x は w の向き）
  const yaw = Math.atan2(l.ux, -l.uy)
  // 局所の箱（a0〜a1・b0〜b1・標高 z0〜z1）。GeoBuilder の箱の局所 x = b の向きにそろえる
  const box = (a0: number, a1: number, b0: number, b1: number, z0: number, z1: number, color: string, mat: number, aux = 0) => {
    if (Math.abs(a1 - a0) < 1e-3 || Math.abs(b1 - b0) < 1e-3 || z1 - z0 < 1e-3) return
    g.box(S((a0 + a1) / 2, (b0 + b1) / 2, (z0 + z1) / 2), [Math.abs(b1 - b0), z1 - z0, Math.abs(a1 - a0)], color, mat, aux, yaw)
  }
  const W = LANDING.width
  const bottom = l.water - 1.6
  const sg = l.sgn
  const s0 = l.aS + sg * (LANDING.stage / 2)
  // 下の段（御影石の厚い板。水の側の縁は stageW）と、水の側の防舷材（黒いゴム）・係留の柱
  const SW = l.stageW
  box(l.aS - sg * (LANDING.stage / 2), s0, 0, SW, bottom, stageTop(l), STONE, TM.stone)
  box(l.aS - sg * (LANDING.stage / 2 - 0.1), s0 - sg * 0.1, SW, SW + 0.08, l.water - 0.15, stageTop(l) - 0.06, '#1c1d1e', TM.dark, 0.3)
  for (const k of [-1, 1]) {
    const a = l.aS + k * (LANDING.stage / 2 - 0.35)
    g.cylinder(S(a, SW - 0.28, stageTop(l)), 0.13, 0.42, 10, IRON, TM.dark, 0.5, true)
    g.cylinder(S(a, SW - 0.28, stageTop(l) + 0.42), 0.17, 0.05, 10, IRON, TM.dark, 0.5, true)
  }
  // 下の段の縁の黄色い線
  box(l.aS - sg * (LANDING.stage / 2 - 0.05), s0, SW - 0.32, SW - 0.22, stageTop(l), stageTop(l) + 0.006, '#d8b41e', TM.paint, 0.2)
  // 段（1 段ずつ、下は水の中まで）
  for (let i = 1; i <= l.steps; i++) {
    const a0 = s0 + sg * (i - 1) * LANDING.tread
    const a1 = s0 + sg * i * LANDING.tread
    const z = stageTop(l) + i * l.rise
    box(Math.min(a0, a1), Math.max(a0, a1), 0, W, bottom, z, i % 2 ? STONE : STONE_D, TM.stone)
  }
  // 上の踊り場と、陸の側の敷石
  const t0 = s0 + sg * l.stairLen
  const t1 = t0 + sg * LANDING.top
  box(Math.min(t0, t1), Math.max(t0, t1), 0, W, bottom, l.top, STONE, TM.stone)
  const ta = topA(l)
  box(ta - LANDING.top / 2 - 0.6, ta + LANDING.top / 2 + 0.6, -LANDING.apron, 0, l.top - 1.4, l.top + 0.02, STONE_D, TM.stone)
  // 石段の水の側の鉄の手すり（段に沿う。下の段の所は乗り降りのために無い）
  const rail = (a: number) => landingZ(l, a, false) + 0.9
  const posts: number[] = []
  for (let k = 0; k <= Math.ceil(l.stairLen / 1.2); k++) posts.push(s0 + sg * Math.min(l.stairLen + LANDING.top - 0.1, 0.15 + k * 1.2))
  for (const a of posts) g.beam(S(a, W - 0.06, landingZ(l, a, true)), S(a, W - 0.06, rail(a)), 0.04, IRON, TM.dark, 0.5)
  for (let k = 1; k < posts.length; k++) g.beam(S(posts[k - 1], W - 0.06, rail(posts[k - 1])), S(posts[k], W - 0.06, rail(posts[k])), 0.045, IRON, TM.dark, 0.5)
  // 「運河バス のりば」の札（上の踊り場の陸の側の柱）と、柱の上の灯り
  const sa = ta + sg * 0.9
  g.beam(S(sa, -0.55, l.top), S(sa, -0.55, l.top + 2.4), 0.07, '#1f4f39', TM.paint, 0.5)
  g.box(S(sa, -0.55, l.top + 2.32), [0.2, 0.22, 0.2], '#ffe2bb', TM.lamp, 1.4, yaw)
  box(sa - 0.5, sa + 0.5, -0.6, -0.5, l.top + 1.45, l.top + 2.05, '#f4f1ea', TM.paint, 0.4)
  const reg = signAtlas.region({ text: l.name, sub: `運河バス のりば ${l.routes.join('・')}航路`, fg: '#1d3b2c', bg: '#f4f1ea', font: 'sans', bold: true, w: 0.96, h: 0.56 })
  for (const s of [1, -1]) {
    const b = s > 0 ? -0.495 : -0.605
    const q = [S(sa - 0.48 * s * sg, b, l.top + 1.47), S(sa + 0.48 * s * sg, b, l.top + 1.47), S(sa + 0.48 * s * sg, b, l.top + 2.03), S(sa - 0.48 * s * sg, b, l.top + 2.03)]
    signs.quad(q[0], q[1], q[2], q[3], reg, 1)
  }
}

/** 町のデータを読んだあとの乗り場（乗る仕組み・舟の横付け・駅員ロボが使う） */
export const boatLandings = { list: [] as BoatLanding[] }

export const landingById = (id: string) => boatLandings.list.find((l) => l.id === id) ?? null
