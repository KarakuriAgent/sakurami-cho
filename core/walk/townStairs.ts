import type { WalkStairs } from './walkData.ts'

/**
 * 町の石段（roads.geojson の stairs。百段石段 108 段・楓坂のつづら道の段 15 本など）の形と高さ。
 * 足元の高さ（townGround）・石段の形（town/townStairsMesh.ts）・石段の下の地形を下げる（terrain.ts）が共有する。
 *
 * 段の並べ方（データの値のとおり）: 段 steps 段を、踊り場 landings 個で (landings + 1) の組に等しく分ける。1 段の踏面は tread、
 * 踊り場の長さは landingLen（0 なら踏面と同じ）。合わせた長さを石段の線（下端 → 上端）の長さに合わせて伸び縮みさせる。
 * 1 段の高さは (上端の標高 − 下端の標高) / 段の数。
 *
 * 段を合わせる所（StairAnchor。設定の本文で「下から n 段目」と決まった家の前など。§7 の 170）があれば、段の数・全体の高さ・踊り場の数は
 * そのままで、n 段目の踏面（踊り場）を決まった位置・高さに置く: その段を踊り場（長さ landing）にして線の上の位置に中心を合わせ、
 * 合わせる所の上と下で、それぞれ 1 段の高さと踏面を等しく割り振る。残りの踊り場は、いちばん長い組の真ん中に置く。
 *
 * 座標は町の平面座標（m。x = 東、y = 北）と標高（m）。このファイルはほかの部品を import しない（walkData の型だけ）。
 */

/**
 * 石段のわきの縁石と擁壁（§7 の 172）の決まり（m）: 判定の刻み step（線の上）、縁石の幅 curb・踏面の線からの高さ curbUp、
 * 擁壁の厚さ wall、擁壁の裏の植え込みの外の端 planting（石段の縁から）、地形を下げる帯の幅 band（石段の縁から。その先は勾配 ramp で元の地面へ）
 */
export const STAIR_SIDE = { step: 0.5, curb: 0.18, curbUp: 0.14, wall: 0.35, planting: 2.0, band: 1.4, ramp: 3 }

/** 段を合わせる所: 石段 stairs の下から step 段目の踏面を、平面の点 (x, y) を線に下ろした所を中心にした長さ landing m の踊り場にして、高さ z（標高）に */
export interface StairAnchor {
  stairs: string
  step: number
  x: number
  y: number
  z: number
  landing: number
}

export interface StairProfile {
  def: WalkStairs
  /** 線の点（平面）と、始めからの長さ */
  pts: [number, number][]
  cum: number[]
  length: number
  /** 下端・上端の標高と、1 段の高さの平均 */
  z0: number
  z1: number
  rise: number
  /** 段の鼻（蹴上げ）の位置（線の上の長さ。下から順に steps 個）。i 番目の鼻を越えると高さは heights[i + 1] */
  nosing: number[]
  /** 踏面ごとの高さ（標高。steps + 1 個。0 = 1 段目の鼻の手前（下端）、steps = いちばん上） */
  heights: number[]
  /** 踏面ごとの奥行き（m。steps + 1 個。0 と steps は端の半分の段）と、踊り場か */
  treads: number[]
  landing: boolean[]
  halfWidth: number
  /** 外接の箱（平面。幅の半分 + 余白を含む） */
  box: [number, number, number, number]
  /**
   * わきの縁石・擁壁を付けるか（[左, 右]。線の上の STAIR_SIDE.step m ごと。1 = 付ける）。ほかの道が石段に入る所・名前のある建物の敷地の前は 0。
   * 町を歩く仕組みが道のグラフと名前のある建物を読んでから入れる（townWalk.ts の init）。null なら付けない
   */
  sides: [Uint8Array, Uint8Array] | null
  /**
   * わきの擁壁と植え込みの上の端（標高。[左, 右]。sides と同じ刻み。擁壁の無い所は −Infinity）。石段の形を作るとき（town/townStairsMesh.ts）に入れる。
   * カメラの当たり（townWalk.ts の stairSideAt）が使う
   */
  sideTop: [Float32Array, Float32Array] | null
}

/** 石段の形を作る（anchors = この石段の段を合わせる所） */
export function stairProfile(def: WalkStairs, anchors: readonly StairAnchor[] = []): StairProfile {
  const pts = def.pts.map((p) => [p[0], p[1]] as [number, number])
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  const length = cum[cum.length - 1]
  const z0 = def.pts[0][2]
  const z1 = def.pts[def.pts.length - 1][2]
  const n = Math.max(1, def.steps)
  const rise = (z1 - z0) / n
  const halfWidth = def.width / 2
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x)
    x1 = Math.max(x1, x)
    y0 = Math.min(y0, y)
    y1 = Math.max(y1, y)
  }
  const m = halfWidth + 3
  const base = { def, pts, cum, length, z0, z1, rise, halfWidth, box: [x0 - m, y0 - m, x1 + m, y1 + m] as [number, number, number, number] }

  // 合わせる所（下から順。段の数・線の上の位置が前の所より先にあるものだけ）
  const pins: { step: number; s: number; z: number; landing: number }[] = []
  for (const a of [...anchors].sort((p, q) => p.step - q.step)) {
    if (a.step < 1 || a.step >= n) continue
    const s = stairLocal(base, a.x, a.y).s
    const prev = pins[pins.length - 1]
    const half = a.landing / 2
    if (s - half <= (prev ? prev.s + prev.landing / 2 : 0) + 0.2 * (a.step - (prev?.step ?? 0)) || s + half >= length - 0.2 * (n - a.step)) continue
    pins.push({ step: a.step, s, z: a.z, landing: a.landing })
  }
  // 踊り場: 合わせる所が無ければ、データの数で (landings + 1) の組に等しく分けた組の間。合わせる所があれば、その段と、
  // 残りはいちばん長い組（合わせる所と踊り場で区切った段の並び）の真ん中に
  const isLanding = new Array<boolean>(n + 1).fill(false)
  for (const p of pins) isLanding[p.step] = true
  if (!pins.length) {
    const flights = Math.max(1, Math.min(n, def.landings + 1))
    let c = 0
    for (let f = 0; f < flights - 1; f++) {
      c += Math.floor(n / flights) + (f < n % flights ? 1 : 0)
      isLanding[c] = true
    }
  }
  let left = pins.length ? Math.max(0, def.landings - pins.length) : 0
  while (left > 0) {
    let bestLen = 0
    let bestAt = -1
    let from = 0
    for (let i = 1; i <= n; i++) {
      if (isLanding[i] || i === n) {
        const len = i - from
        if (len > bestLen + 1) {
          bestLen = len
          bestAt = from + Math.floor(len / 2)
        }
        from = i
      }
    }
    if (bestAt <= 0 || bestAt >= n) break
    isLanding[bestAt] = true
    left--
  }
  // 高さ: 合わせる所の間で 1 段の高さを等しく
  const heights = new Array<number>(n + 1)
  const ends = [{ step: 0, s: 0, z: z0, landing: 0 }, ...pins, { step: n, s: length, z: z1, landing: 0 }]
  for (let k = 1; k < ends.length; k++) {
    const a = ends[k - 1]
    const b = ends[k]
    for (let i = a.step; i <= b.step; i++) heights[i] = a.z + ((b.z - a.z) * (i - a.step)) / (b.step - a.step)
  }
  // 踏面: 合わせる所の間で、踏面 1 つ = 1、データの踊り場 = landingLen / tread（0 なら 1）、両端の半分の段 = 0.5 の割合で長さを割り振る
  const dataLanding = def.landingLen > 0 ? def.landingLen / def.tread : 1
  const nosing = new Array<number>(n)
  for (let k = 1; k < ends.length; k++) {
    const a = ends[k - 1]
    const b = ends[k]
    // 区間の始めの鼻（a.step 番目の鼻の位置 = 下端なら 0.5 単位の先、合わせる所なら踊り場の上の端）と終わりの鼻
    const sFrom = a.step === 0 ? 0 : a.s + a.landing / 2
    const sTo = b.step === n ? length : b.s - b.landing / 2
    // 単位: 鼻 a.step（0 始まりの番号 a.step）から鼻 b.step − 1 まで
    let units = a.step === 0 ? 0.5 : 0
    const at: number[] = []
    for (let i = a.step; i < b.step; i++) {
      if (i > a.step) units += isLanding[i] && !pins.some((p) => p.step === i) ? dataLanding : 1
      at.push(units)
    }
    const total = units + (b.step === n ? 0.5 : 0)
    const unit = (sTo - sFrom) / Math.max(total, 1e-6)
    for (let i = a.step; i < b.step; i++) nosing[i] = sFrom + at[i - a.step] * unit
  }
  const treads = new Array<number>(n + 1)
  for (let i = 0; i <= n; i++) treads[i] = (i === n ? length : nosing[i]) - (i === 0 ? 0 : nosing[i - 1])
  return { ...base, nosing, heights, treads, landing: isLanding, sides: null, sideTop: null }
}

/** 線の上の長さ s の、左（side = 1）か右（side = −1）のわきに縁石・擁壁を付けるか */
export function stairSideOn(p: StairProfile, s: number, side: number) {
  const list = p.sides?.[side >= 0 ? 0 : 1]
  if (!list) return false
  const i = Math.floor(s / STAIR_SIDE.step)
  return i >= 0 && i < list.length && list[i] === 1
}

/** 線の上の長さ s の踏面の番号（越えた鼻の数。0〜steps） */
export function stairTreadIndex(p: StairProfile, s: number) {
  let lo = 0
  let hi = p.nosing.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (p.nosing[mid] <= s) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** 線の上の長さ s の近くの 1 段の高さ（m。いちばん近い鼻の段） */
export function stairRiseAt(p: StairProfile, s: number) {
  const i = stairTreadIndex(p, s)
  const n = p.nosing.length
  if (n === 0) return p.rise
  // 近い方の鼻（i − 1 番目か i 番目）
  const k = i >= n ? n - 1 : i === 0 ? 0 : s - p.nosing[i - 1] < p.nosing[i] - s ? i - 1 : i
  return p.heights[k + 1] - p.heights[k]
}

/** 線の上の長さ s の踏面の奥行き（m。踊り場の上なら、となりの段の踏面） */
export function stairTreadAt(p: StairProfile, s: number) {
  const i = stairTreadIndex(p, s)
  const n = p.nosing.length
  if (!p.landing[i] && i > 0 && i < n) return p.treads[i]
  for (let d = 1; d < n; d++) {
    for (const j of [i - d, i + d]) if (j > 0 && j < n && !p.landing[j]) return p.treads[j]
  }
  return p.def.tread
}

/** 点を石段の線に投影（線の上の長さ s・線からの横の距離 d（左が +）・線の向き） */
export function stairLocal(p: Pick<StairProfile, 'pts' | 'cum'>, x: number, y: number) {
  let best = Infinity
  let s = 0
  let side = 0
  let dx = 1
  let dy = 0
  for (let i = 1; i < p.pts.length; i++) {
    const [ax, ay] = p.pts[i - 1]
    const ex = p.pts[i][0] - ax
    const ey = p.pts[i][1] - ay
    const l2 = ex * ex + ey * ey
    const l = Math.sqrt(l2) || 1
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * ex + (y - ay) * ey) / l2)) : 0
    const px = ax + ex * t
    const py = ay + ey * t
    const d = Math.hypot(x - px, y - py)
    if (d < best) {
      best = d
      s = p.cum[i - 1] + t * l
      side = ((x - ax) * -ey + (y - ay) * ex) / l
      dx = ex / l
      dy = ey / l
    }
  }
  return { s, d: best, side, dx, dy }
}

/** 線の上の長さ s の段の高さ（段そのもの。標高） */
export function stairStepZ(p: StairProfile, s: number) {
  return p.heights[stairTreadIndex(p, s)]
}

/**
 * 線の上の長さ s の体の高さ（なめらかな坂。標高）: 段の鼻の前後 c（踏面の半分か 0.22m の小さい方）だけを坂でつなぐので、
 * 長い踊り場の上は平ら
 */
export function stairSmoothZ(p: StairProfile, s: number) {
  const n = p.nosing
  const lo = stairTreadIndex(p, s)
  // s は鼻 lo − 1 と鼻 lo の間（踏面 lo）。近い方の鼻の坂の中なら補う
  const z = p.heights[lo]
  const reach = (i: number) => {
    const before = i > 0 ? n[i] - n[i - 1] : Infinity
    const after = i < n.length - 1 ? n[i + 1] - n[i] : Infinity
    return Math.min(0.22, before / 2, after / 2)
  }
  if (lo < n.length) {
    const c = reach(lo)
    const r = p.heights[lo + 1] - p.heights[lo]
    if (n[lo] - s < c) return z + r * (0.5 - (n[lo] - s) / (2 * c))
  }
  if (lo > 0) {
    const c = reach(lo - 1)
    const r = p.heights[lo] - p.heights[lo - 1]
    if (s - n[lo - 1] < c) return z - r * (0.5 - (s - n[lo - 1]) / (2 * c))
  }
  return z
}

/** 線の上の長さ s の点（平面）と向き */
export function stairPoint(p: StairProfile, s: number) {
  const d = Math.min(Math.max(s, 0), p.length)
  let i = 1
  while (i < p.cum.length - 1 && p.cum[i] < d) i++
  const l = p.cum[i] - p.cum[i - 1] || 1
  const t = (d - p.cum[i - 1]) / l
  const [ax, ay] = p.pts[i - 1]
  const [bx, by] = p.pts[i]
  return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, dx: (bx - ax) / l, dy: (by - ay) / l }
}

/** 石段の索引（平面の升） */
export class StairIndex {
  readonly profiles: StairProfile[]
  private grid = new Map<number, number[]>()
  private static CELL = 16

  constructor(defs: WalkStairs[], skip: ReadonlySet<string> = new Set(), anchors: readonly StairAnchor[] = []) {
    this.profiles = defs.filter((d) => !skip.has(d.id)).map((d) => stairProfile(d, anchors.filter((a) => a.stairs === d.id)))
    const C = StairIndex.CELL
    this.profiles.forEach((p, i) => {
      const [x0, y0, x1, y1] = p.box
      for (let gx = Math.floor(x0 / C); gx <= Math.floor(x1 / C); gx++)
        for (let gy = Math.floor(y0 / C); gy <= Math.floor(y1 / C); gy++) {
          const k = gx * 100003 + gy
          let l = this.grid.get(k)
          if (!l) this.grid.set(k, (l = []))
          l.push(i)
        }
    })
  }

  /** 点の近く（線から margin m より近い。幅の半分 + margin まで）の石段と、線の上の位置。無ければ null */
  at(x: number, y: number, margin = 0) {
    const C = StairIndex.CELL
    const list = this.grid.get(Math.floor(x / C) * 100003 + Math.floor(y / C))
    if (!list) return null
    let best: { profile: StairProfile; s: number; d: number; side: number; dx: number; dy: number } | null = null
    for (const i of list) {
      const p = this.profiles[i]
      const [x0, y0, x1, y1] = p.box
      if (x < x0 || x > x1 || y < y0 || y > y1) continue
      const q = stairLocal(p, x, y)
      // 両端より先（下端の手前・上端の先）は含めない
      if (q.s <= 0.001 || q.s >= p.length - 0.001) continue
      if (q.d > p.halfWidth + margin) continue
      if (!best || q.d < best.d) best = { profile: p, ...q }
    }
    return best
  }
}
