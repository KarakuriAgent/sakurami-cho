import { SITE } from '../../../core/town'
import type { ShapeBatch } from '../shapes'
import { STAIR_SIDE, stairPoint, stairRiseAt, stairSmoothZ, stairStepZ, type StairIndex, type StairProfile } from '../../../core/walk/townStairs'
import { terrainBaseHeight, terrainHeight } from './terrain'
import type { ShrubItem } from './landmarks'

/**
 * 町の石段の形（百段石段・楓坂のつづら道の段など。データの段の数・踏面・踊り場のとおり。高さと位置は core/walk/townStairs.ts）。
 * 段ごとの石の塊（上の面・蹴上げ・両わき。下は均した地面の 0.3m 下まで）と、手すりのある石段は両わきの手すり（高さ 0.85m）。
 * わき（core/walk/townStairs.ts の sides。ほかの道が入る所・名前のある建物の敷地の前は除く）は、縁石（地面が段より低い所）か、
 * 高さに応じた石積みの擁壁と、擁壁の裏の植え込み（地面が段より高い所。下げた地形の土の斜面を隠す。§7 の 172）。
 * 両わきには足元灯（LIGHT_EVERY m ごとに左右を互い違いに。縁石・低い擁壁の上は小さな柱の灯り（百段石段は石灯籠風）、
 * 高い擁壁は壁に付けた灯り。夜の灯りの表と花音を照らす灯りにも入れる。§7 の 173）。
 * 町の構造物の形（infraMeshes.ts の buildInfraGeometry）にまとめて 1 回で描く
 */

const LAB = SITE.labFloorElevation
const S = (x: number, y: number, z: number): [number, number, number] => [x, z - LAB, -y]

const COLOR = { tread: '#a39d92', riser: '#8f897e', side: '#857f75', rail: '#3b3a37', post: '#4a4844', curb: '#9b958a', coping: '#a8a296', joint: '#6b665d', soil: '#3f3628' }
/** 擁壁の石（段の石に合わせた灰色の幅） */
const STONES = ['#8d877b', '#857f73', '#938d81', '#7f796e', '#8a8378', '#969083']
/** 擁壁の石の段（m） */
const COURSE = 0.32
/** 足元灯の間隔（片側。m）と、灯具の色・光 */
const LIGHT_EVERY = 7
const LAMP_GLOW: [string, number] = ['#ffcf8a', 4]

/** 石段の足元灯（平面座標と標高。灯りの点・灯りの表に入れる） */
export interface StairLight {
  x: number
  y: number
  z: number
  seed: number
}

/** 縦長の箱（平面の点 (x, y) を中心に、向き (dx, dy) の長さ 2·ha・横 2·hc、高さ z0〜z1。上と 4 つの横の面） */
function prism(b: ShapeBatch, x: number, y: number, dx: number, dy: number, ha: number, hc: number, z0: number, z1: number, color: string, emit?: [string, number]) {
  const c = [
    [x - dx * ha + dy * hc, y - dy * ha - dx * hc],
    [x + dx * ha + dy * hc, y + dy * ha - dx * hc],
    [x + dx * ha - dy * hc, y + dy * ha + dx * hc],
    [x - dx * ha - dy * hc, y - dy * ha + dx * hc],
  ]
  for (let i = 0; i < 4; i++) {
    const a = c[i]
    const e = c[(i + 1) % 4]
    b.quad(S(a[0], a[1], z0), S(e[0], e[1], z0), S(e[0], e[1], z1), S(a[0], a[1], z1), color, emit)
  }
  b.quad(S(c[0][0], c[0][1], z1), S(c[1][0], c[1][1], z1), S(c[2][0], c[2][1], z1), S(c[3][0], c[3][1], z1), color, emit)
}

/** 線の上の [a, b] を、線の折れ目で分けた区間（平面の点と向き） */
function spans(p: StairProfile, a: number, b: number) {
  const out: { s0: number; s1: number; x0: number; y0: number; x1: number; y1: number; nx: number; ny: number }[] = []
  for (let i = 1; i < p.pts.length; i++) {
    const c0 = p.cum[i - 1]
    const c1 = p.cum[i]
    const u = Math.max(a, c0)
    const v = Math.min(b, c1)
    if (v - u < 1e-4) continue
    const [ax, ay] = p.pts[i - 1]
    const [bx, by] = p.pts[i]
    const l = c1 - c0 || 1
    const dx = (bx - ax) / l
    const dy = (by - ay) / l
    out.push({ s0: u, s1: v, x0: ax + dx * (u - c0), y0: ay + dy * (u - c0), x1: ax + dx * (v - c0), y1: ay + dy * (v - c0), nx: -dy, ny: dx })
  }
  return out
}

function addStair(b: ShapeBatch, p: StairProfile) {
  const n = p.nosing.length
  const h = p.halfWidth
  for (let i = 0; i <= n; i++) {
    const a = i === 0 ? 0 : p.nosing[i - 1]
    const e = i === n ? p.length : p.nosing[i]
    if (e - a < 1e-3) continue
    const z = p.heights[i]
    const parts = spans(p, a, e + (i < n ? 0.01 : 0))
    for (const q of parts) {
      const L0 = [q.x0 + q.nx * h, q.y0 + q.ny * h]
      const R0 = [q.x0 - q.nx * h, q.y0 - q.ny * h]
      const L1 = [q.x1 + q.nx * h, q.y1 + q.ny * h]
      const R1 = [q.x1 - q.nx * h, q.y1 - q.ny * h]
      const bot = Math.min(terrainHeight(L0[0], L0[1]), terrainHeight(R0[0], R0[1]), terrainHeight(L1[0], L1[1]), terrainHeight(R1[0], R1[1]), z - 0.25) - 0.3
      // 上の面
      b.quad(S(L0[0], L0[1], z), S(L1[0], L1[1], z), S(R1[0], R1[1], z), S(R0[0], R0[1], z), COLOR.tread)
      // 両わき
      b.quad(S(L0[0], L0[1], bot), S(L1[0], L1[1], bot), S(L1[0], L1[1], z), S(L0[0], L0[1], z), COLOR.side)
      b.quad(S(R0[0], R0[1], bot), S(R1[0], R1[1], bot), S(R1[0], R1[1], z), S(R0[0], R0[1], z), COLOR.side)
      // 蹴上げ（段の鼻）
      if (q.s0 === a && i > 0) b.quad(S(L0[0], L0[1], bot), S(R0[0], R0[1], bot), S(R0[0], R0[1], z), S(L0[0], L0[1], z), COLOR.riser)
      // いちばん上の段の先
      if (i === n && q.s1 >= p.length - 1e-3) b.quad(S(L1[0], L1[1], bot), S(R1[0], R1[1], bot), S(R1[0], R1[1], z), S(L1[0], L1[1], z), COLOR.riser)
    }
  }
  // 手すり（データの路面に「手すり」とある石段）
  if (!(p.def.surface ?? '').includes('手すり')) return
  const step = 1.0
  const count = Math.max(1, Math.ceil(p.length / step))
  for (const side of [1, -1]) {
    let prev: [number, number, number] | null = null
    for (let k = 0; k <= count; k++) {
      const s = Math.min(p.length, k * step)
      const q = spans(p, Math.max(0, s - 1e-3), Math.min(p.length, s + 1e-3))[0] ?? spans(p, Math.max(0, s - 0.01), s)[0]
      if (!q) continue
      const t = (s - q.s0) / Math.max(1e-6, q.s1 - q.s0)
      const x = q.x0 + (q.x1 - q.x0) * t + q.nx * (h - 0.06) * side
      const y = q.y0 + (q.y1 - q.y0) * t + q.ny * (h - 0.06) * side
      const z = stairSmoothZ(p, s) + 0.85
      const cur: [number, number, number] = [x, y, z]
      if (prev) {
        // 手すりの棒（上の面と両わきの細い帯）
        b.quad(S(prev[0], prev[1], prev[2]), S(cur[0], cur[1], cur[2]), S(cur[0], cur[1], cur[2] - 0.05), S(prev[0], prev[1], prev[2] - 0.05), COLOR.rail)
      }
      // 支柱（2m ごと）
      if (k % 2 === 0) {
        const ox = q.nx * 0.025
        const oy = q.ny * 0.025
        b.quad(S(x - ox, y - oy, z - 0.85), S(x + ox, y + oy, z - 0.85), S(x + ox, y + oy, z), S(x - ox, y - oy, z), COLOR.post)
        const tx = (q.x1 - q.x0) / Math.max(1e-6, Math.hypot(q.x1 - q.x0, q.y1 - q.y0)) * 0.025
        const ty = (q.y1 - q.y0) / Math.max(1e-6, Math.hypot(q.x1 - q.x0, q.y1 - q.y0)) * 0.025
        b.quad(S(x - tx, y - ty, z - 0.85), S(x + tx, y + ty, z - 0.85), S(x + tx, y + ty, z), S(x - tx, y - ty, z), COLOR.post)
      }
      prev = cur
    }
  }
}

/** 0〜1 の決まった乱数 */
const hash = (a: number, b: number, c: number) => {
  const v = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453
  return v - Math.floor(v)
}

/** わきの縁石・擁壁・植え込み（左 side = 1・右 side = −1） */
function addSide(b: ShapeBatch, p: StairProfile, k: 0 | 1, seed: number, shrubs: ShrubItem[] | null, lights: StairLight[]) {
  const on = p.sides?.[k]
  if (!on) return
  const side = k === 0 ? 1 : -1
  const st = STAIR_SIDE
  const hw = p.halfWidth
  const n = on.length
  // 区切りの点（j = 0〜n。線の上の j × step）の値
  const ss = Array.from({ length: n + 1 }, (_, j) => Math.min(p.length, j * st.step))
  const pt = ss.map((s) => stairPoint(p, s))
  const tread = ss.map((s) => stairSmoothZ(p, s))
  const low = ss.map((s, j) => tread[j] - stairRiseAt(p, s) - 0.1)
  /** 石段の縁から d m 外の点（平面） */
  const at = (j: number, d: number): [number, number] => [pt[j].x - pt[j].dy * (hw + d) * side, pt[j].y + pt[j].dx * (hw + d) * side]
  // 擁壁の裏の元の地面のいちばん高い所（下げる前の標高）
  const back = ss.map((_, j) => Math.max(...[0.1, 0.6, 1.1, 1.6, 2.0, 2.4].map((d) => terrainBaseHeight(...at(j, d)))))
  // 区間ごとの作り方: 0 = なし、1 = 縁石、2 = 擁壁（裏の地面が下げた高さより高い）
  const kind = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (!on[i] || ss[i + 1] - ss[i] < 1e-3) continue
    kind[i] = Math.max(back[i] - low[i], back[i + 1] - low[i + 1]) > 0.05 ? 2 : 1
  }
  // 擁壁の上端（元の地面 + 3cm か縁石の高さの大きい方。前後 1m のいちばん高い所でならす）
  const need = ss.map((_, j) => Math.max(tread[j] + st.curbUp, back[j] + 0.03))
  const wallTop = need.map((_, j) => Math.max(...need.slice(Math.max(0, j - 2), j + 3)))
  // カメラの当たり（擁壁と植え込みの低木の上まで。townWalk.stairSideAt）
  const tops = new Float32Array(n).fill(-Infinity)
  for (let i = 0; i < n; i++) if (kind[i] === 2) tops[i] = Math.max(wallTop[i], wallTop[i + 1]) + 0.07 + 0.9
  p.sideTop ??= [new Float32Array(n).fill(-Infinity), new Float32Array(n).fill(-Infinity)]
  p.sideTop[k] = tops
  // 足元灯（左右を互い違いに。ほかの道が入る所・建物の敷地の前は置かない）
  const lantern = p.def.id === 'stairs.hyakudan'
  for (let sl = LIGHT_EVERY * (k === 0 ? 0.5 : 1); sl < p.length - 1; sl += LIGHT_EVERY) {
    const i = Math.floor(sl / st.step)
    if (i >= n || !kind[i]) continue
    const q = stairPoint(p, sl)
    const tz = stairStepZ(p, sl)
    const across = (d: number): [number, number] => [q.x - q.dy * (hw + d) * side, q.y + q.dx * (hw + d) * side]
    const wallH = kind[i] === 2 ? wallTop[i] - tread[i] : 0
    if (wallH > 0.5) {
      // 高い擁壁: 壁に付けた灯り（段の上 0.32m。石段の側へ少し出る箱と、上のひさし）
      const [lx, ly] = across(-0.03)
      prism(b, lx, ly, q.dx, q.dy, 0.13, 0.035, tz + 0.27, tz + 0.37, '#2c2b29')
      const [fx, fy] = across(-0.068)
      b.quad(S(fx - q.dx * 0.1, fy - q.dy * 0.1, tz + 0.285), S(fx + q.dx * 0.1, fy + q.dy * 0.1, tz + 0.285), S(fx + q.dx * 0.1, fy + q.dy * 0.1, tz + 0.345), S(fx - q.dx * 0.1, fy - q.dy * 0.1, tz + 0.345), '#ffe2b4', LAMP_GLOW)
      const [hx, hy] = across(-0.05)
      prism(b, hx, hy, q.dx, q.dy, 0.15, 0.06, tz + 0.37, tz + 0.39, '#2c2b29')
      const [px, py] = across(-0.25)
      lights.push({ x: px, y: py, z: tz + 0.33, seed: hash(seed, i, 61 + k) * 0.5 })
      continue
    }
    // 縁石・低い擁壁の上の柱の灯り
    const d = kind[i] === 2 ? st.wall / 2 : st.curb / 2
    const base = kind[i] === 2 ? wallTop[i] + 0.07 : tread[i] + st.curbUp
    const lz = Math.max(base + 0.3, tz + 0.6)
    const [x, y] = across(d)
    if (lantern) {
      // 石灯籠風（台・竿・火袋・笠・宝珠）
      prism(b, x, y, q.dx, q.dy, 0.13, 0.13, base - 0.05, base + 0.08, '#8f897d')
      prism(b, x, y, q.dx, q.dy, 0.06, 0.06, base + 0.08, lz - 0.1, '#8a8478')
      prism(b, x, y, q.dx, q.dy, 0.1, 0.1, lz - 0.1, lz - 0.08, '#8f897d')
      prism(b, x, y, q.dx, q.dy, 0.075, 0.075, lz - 0.08, lz + 0.08, '#ffdcaa', LAMP_GLOW)
      prism(b, x, y, q.dx, q.dy, 0.16, 0.16, lz + 0.08, lz + 0.13, '#857f73')
      prism(b, x, y, q.dx, q.dy, 0.09, 0.09, lz + 0.13, lz + 0.18, '#857f73')
      prism(b, x, y, q.dx, q.dy, 0.035, 0.035, lz + 0.18, lz + 0.24, '#8a8478')
    } else {
      // 細い角柱の灯り（濃い灰の金属。上に光る箱と笠）
      prism(b, x, y, q.dx, q.dy, 0.045, 0.045, base - 0.05, lz - 0.07, '#33312e')
      prism(b, x, y, q.dx, q.dy, 0.06, 0.06, lz - 0.07, lz + 0.05, '#ffdcaa', LAMP_GLOW)
      prism(b, x, y, q.dx, q.dy, 0.08, 0.08, lz + 0.05, lz + 0.08, '#33312e')
    }
    lights.push({ x, y, z: lz, seed: hash(seed, i, 61 + k) * 0.5 })
  }
  for (let i = 0; i < n; ) {
    const kd = kind[i]
    if (!kd) {
      i++
      continue
    }
    let e = i
    while (e < n && kind[e] === kd) e++
    // 区切りの点 i〜e の帯
    const outer = kd === 2 ? st.wall : st.curb
    const top = (j: number) => (kd === 2 ? wallTop[j] : tread[j] + st.curbUp)
    const bot = (j: number) => Math.min(terrainHeight(...at(j, outer)), low[j]) - 0.3
    const P = (j: number, d: number, z: number) => {
      const q = at(j, d)
      return S(q[0], q[1], z)
    }
    for (let j = i; j < e; j++) {
      const j1 = j + 1
      // 外の面・上の面（縁石の上・擁壁の笠石）
      b.quad(P(j, outer, bot(j)), P(j1, outer, bot(j1)), P(j1, outer, top(j1)), P(j, outer, top(j)), kd === 2 ? STONES[0] : COLOR.curb)
      if (kd === 1) {
        b.quad(P(j, 0, top(j)), P(j1, 0, top(j1)), P(j1, outer, top(j1)), P(j, outer, top(j)), COLOR.curb)
        b.quad(P(j, 0, bot(j)), P(j1, 0, bot(j1)), P(j1, 0, top(j1)), P(j, 0, top(j)), COLOR.curb)
        continue
      }
      // 擁壁の石段側の面: 石の段（踏面の線に沿う）を 1m の石で、段ごとに半分ずらす
      const base = (jj: number) => tread[jj] - 0.12
      for (let r = 0; ; r++) {
        const z0a = base(j) + r * COURSE
        const z0b = base(j1) + r * COURSE
        if (z0a >= top(j) && z0b >= top(j1)) break
        const z1a = Math.min(top(j), z0a + COURSE)
        const z1b = Math.min(top(j1), z0b + COURSE)
        const stone = Math.floor((j + (r % 2)) / 2)
        const c = STONES[Math.floor(hash(seed, stone, r + k * 50) * STONES.length)]
        b.quad(P(j, 0, Math.min(z0a, top(j))), P(j1, 0, Math.min(z0b, top(j1))), P(j1, 0, z1b), P(j, 0, z1a), c)
        // 目地（石の段の境の細い影）
        if (r > 0 && z0a < top(j) - 0.02 && z0b < top(j1) - 0.02) b.quad(P(j, -0.004, z0a - 0.012), P(j1, -0.004, z0b - 0.012), P(j1, -0.004, z0b + 0.012), P(j, -0.004, z0a + 0.012), COLOR.joint)
      }
      // 石段の段より下（地面まで）
      b.quad(P(j, 0, bot(j)), P(j1, 0, bot(j1)), P(j1, 0, base(j1)), P(j, 0, base(j)), STONES[3])
      // 縦の目地（石の境: 2 区間ごと、段ごとに半分ずらす）
      for (let r = 0; ; r++) {
        const za = base(j) + r * COURSE
        if (za >= top(j)) break
        if ((j + (r % 2)) % 2 !== 0) continue
        const zb = Math.min(top(j), za + COURSE)
        const q0 = at(j, -0.004)
        const tx = pt[j].dx * 0.012
        const ty = pt[j].dy * 0.012
        b.quad(S(q0[0] - tx, q0[1] - ty, za), S(q0[0] + tx, q0[1] + ty, za), S(q0[0] + tx, q0[1] + ty, zb), S(q0[0] - tx, q0[1] - ty, zb), COLOR.joint)
      }
      // 笠石（上の面と、少し張り出した縁）
      const c0 = -0.03
      const c1 = outer + 0.04
      const t0 = top(j) + 0.07
      const t1 = top(j1) + 0.07
      b.quad(P(j, c0, t0), P(j1, c0, t1), P(j1, c1, t1), P(j, c1, t0), COLOR.coping)
      b.quad(P(j, c0, top(j)), P(j1, c0, top(j1)), P(j1, c0, t1), P(j, c0, t0), COLOR.coping)
      b.quad(P(j, c1, top(j)), P(j1, c1, top(j1)), P(j1, c1, t1), P(j, c1, t0), COLOR.coping)
      // 擁壁の裏の植え込みの床（土。下げた地形と戻しの坂を隠す）と、その上の低木（town/trees.ts の shrubMesh。shrubs に入れる）
      const h0 = outer + 0.04
      const h1 = st.planting
      const bedA = top(j) + 0.05
      const bedB = top(j1) + 0.05
      b.quad(P(j, h0, bedA), P(j1, h0, bedB), P(j1, h1, bedB - 0.04), P(j, h1, bedA - 0.04), COLOR.soil)
      b.quad(P(j, h1, low[j] - 0.3), P(j1, h1, low[j1] - 0.3), P(j1, h1, bedB - 0.04), P(j, h1, bedA - 0.04), COLOR.soil)
      if (shrubs) {
        const s0 = ss[j]
        for (const [d, k2] of [
          [outer + 0.5, 0],
          [st.planting - 0.55, 1],
        ] as const) {
          const r1 = hash(seed, j, 11 + k2 + k * 3)
          if (k2 === 1 && r1 < 0.35) continue
          const sm = s0 + (k2 === 1 ? 0.5 : 0.25) * st.step + (r1 - 0.5) * 0.2
          const f = Math.min(1, Math.max(0, (sm - s0) / Math.max(1e-6, ss[j1] - s0)))
          const q = stairPoint(p, sm)
          const dd = hw + d + (hash(seed, j, 21 + k2) - 0.5) * 0.25
          const ht = 0.55 + 0.45 * hash(seed, j, 31 + k2) + Math.min(0.5, 0.15 * Math.max(0, top(j) - tread[j]))
          shrubs.push({ x: q.x - q.dy * dd * side, y: q.y + q.dx * dd * side, z: bedA + (bedB - bedA) * f - 0.15, h: ht, r: 0.42 + 0.22 * hash(seed, j, 41 + k2), seed: hash(seed, j, 51 + k2) })
        }
      }
    }
    // 端の面（区間の始めと終わり）
    for (const j of [i, e]) {
      if (kd === 1) {
        b.quad(P(j, 0, bot(j)), P(j, outer, bot(j)), P(j, outer, top(j)), P(j, 0, top(j)), COLOR.curb)
        continue
      }
      b.quad(P(j, -0.03, bot(j)), P(j, outer + 0.04, bot(j)), P(j, outer + 0.04, top(j) + 0.07), P(j, -0.03, top(j) + 0.07), STONES[2])
      b.quad(P(j, outer + 0.04, low[j] - 0.3), P(j, st.planting, low[j] - 0.3), P(j, st.planting, top(j) + 0.01), P(j, outer + 0.04, top(j) + 0.05), COLOR.soil)
    }
    i = e
  }
}


/**
 * 町の石段をまとめて足す。擁壁の裏の植え込みの低木（landscape.ts が town/trees.ts の shrubMesh で描く）と、
 * 足元灯（灯りの点・夜の灯りの表）を返す
 */
export function addTownStairs(b: ShapeBatch, index: StairIndex | null): { shrubs: ShrubItem[]; lights: StairLight[] } {
  const shrubs: ShrubItem[] = []
  const lights: StairLight[] = []
  if (!index) return { shrubs, lights }
  index.profiles.forEach((p, i) => {
    addStair(b, p)
    addSide(b, p, 0, i + 1, shrubs, lights)
    addSide(b, p, 1, i + 1, shrubs, lights)
  })
  return { shrubs, lights }
}
