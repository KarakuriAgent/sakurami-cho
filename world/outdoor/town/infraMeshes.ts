import { CABLE_TRACK_FROM, cableUL } from '../../../core/cableStations'
import * as THREE from 'three'
import { SITE } from '../../../core/town'
import { BOX, CONE16, CYL16, ShapeBatch } from '../shapes'
import { townData, type P3, type TownInfra, type TownStructure } from './townData'
import { LIGHT_KIND, type LightItem } from './lights'
import { Path } from '../transit/transitData'
import { addTownStairs } from './townStairsMesh'
import type { StairIndex } from '../../../core/walk/townStairs'

/**
 * 町の構造物の形（岸壁・防波堤・鉄道の築堤と高架と石造アーチ・ホーム・道の橋・ケーブルの線路・クレーン・灯台・大パラボラ・記念塔など）。
 * どれも頂点の色と夜の光（aEmit）を持つ 1 つの形にまとめて、構造物のシェーダー（materials.ts の createStructureMaterial）で 1 回で描く。
 * 観覧車ソラノワとガーデンドームは専用のシェーダーなので別の形（structureObjects）。
 */

const LAB = SITE.labFloorElevation
const S = (x: number, y: number, z: number): [number, number, number] => [x, z - LAB, -y]
const ground = (x: number, y: number) => townData.heightAt(x, y)

const COLOR = {
  quay: '#8c887f',
  seawall: '#7b786f',
  canal: '#b7b1a5',
  pond: '#a7a196',
  retaining: '#a19d93',
  breakwater: '#98948b',
  ballast: '#6a625a',
  embankment: '#55603e',
  concrete: '#b3afa6',
  viaductDark: '#7d7a73',
  brick: '#8a5a44',
  brickDark: '#6f4636',
  stoneTrim: '#b5a993',
  girder: '#3e4b45',
  platform: '#a6a299',
  canopy: '#4f7d68',
  bridgeStone: '#a49c8e',
  bridgeConcrete: '#aaa69e',
  cableBed: '#5a5650',
  cableLeg: '#2e2c2a',
  craneRed: '#c62828',
  craneWhite: '#eeeeec',
  rust: '#8e5a3e',
  rustDark: '#5d3a2a',
}

/** 折れ線の点ごとの左右の向き（平面の単位ベクトル。角では前後の平均） */
function sideVectors(pts: readonly (readonly number[])[]) {
  return pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const l = Math.hypot(dx, dy) || 1
    return [-dy / l, dx / l] as [number, number]
  })
}

/** 折れ線を、長さ step m 以下の区間に細かくする（3D の点。z は線形に補う） */
export function densify<T extends readonly number[]>(pts: readonly T[], step: number): number[][] {
  const out: number[][] = [[...pts[0]]]
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step))
    for (let k = 1; k <= n; k++) out.push(a.map((v, j) => v + (b[j] - v) * (k / n)))
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* 岸壁・防波堤・擁壁                                                              */
/* -------------------------------------------------------------------------- */

function addWalls(b: ShapeBatch, infra: TownInfra) {
  for (const w of infra.walls) {
    const color = COLOR[w.kind as keyof typeof COLOR] ?? COLOR.quay
    const pts = densify(w.pts, w.follow ? 4 : 20)
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1]
      const [bx, by] = pts[i]
      if (w.follow) {
        // 地面から立つ擁壁（厚み 0.5m と上の笠石）
        const ga = ground(ax, ay)
        const gb = ground(bx, by)
        const len = Math.hypot(bx - ax, by - ay) || 1
        const nx = (-(by - ay) / len) * 0.25
        const ny = ((bx - ax) / len) * 0.25
        for (const s of [-1, 1]) b.quad(S(ax + nx * s, ay + ny * s, ga - 0.5), S(bx + nx * s, by + ny * s, gb - 0.5), S(bx + nx * s, by + ny * s, gb + w.follow), S(ax + nx * s, ay + ny * s, ga + w.follow), color)
        b.quad(S(ax + nx, ay + ny, ga + w.follow), S(bx + nx, by + ny, gb + w.follow), S(bx - nx, by - ny, gb + w.follow), S(ax - nx, ay - ny, ga + w.follow), color)
      } else {
        const top = w.top ?? 2.5
        const bot = w.bottom ?? -2.5
        b.quad(S(ax, ay, bot), S(bx, by, bot), S(bx, by, top), S(ax, ay, top), color)
      }
    }
  }
  for (const bw of infra.breakwaters) {
    const pts = bw.pts
    const sv = sideVectors(pts)
    const h = bw.width / 2
    const L = pts.map((p, i) => [p[0] + sv[i][0] * h, p[1] + sv[i][1] * h])
    const R = pts.map((p, i) => [p[0] - sv[i][0] * h, p[1] - sv[i][1] * h])
    for (let i = 1; i < pts.length; i++) {
      b.quad(S(L[i - 1][0], L[i - 1][1], bw.crest), S(L[i][0], L[i][1], bw.crest), S(R[i][0], R[i][1], bw.crest), S(R[i - 1][0], R[i - 1][1], bw.crest), COLOR.breakwater)
      for (const E of [L, R]) b.quad(S(E[i - 1][0], E[i - 1][1], -3), S(E[i][0], E[i][1], -3), S(E[i][0], E[i][1], bw.crest), S(E[i - 1][0], E[i - 1][1], bw.crest), COLOR.seawall)
    }
    for (const i of [0, pts.length - 1]) b.quad(S(L[i][0], L[i][1], -3), S(R[i][0], R[i][1], -3), S(R[i][0], R[i][1], bw.crest), S(L[i][0], L[i][1], bw.crest), COLOR.seawall)
  }
}

/* -------------------------------------------------------------------------- */
/* 鉄道                                                                         */
/* -------------------------------------------------------------------------- */

/** 砂利の路盤（地平・築堤）。z はレール面。築堤は地面までの斜面（草）をつける（slopes = false は高架の上の路盤だけ） */
function addBallast(b: ShapeBatch, pts3: readonly P3[], tracks: number, slopes = true) {
  const pts = densify(pts3, 6)
  const sv = sideVectors(pts)
  const half = (tracks * 4.0 + 1.6) / 2
  const edge = pts.map((p, i) => {
    const top = p[2] - 0.25
    const out: { l: number[]; r: number[]; gl: number[]; gr: number[] } = { l: [], r: [], gl: [], gr: [] }
    for (const s of [1, -1]) {
      const ex = p[0] + sv[i][0] * half * s
      const ey = p[1] + sv[i][1] * half * s
      const g = ground(ex, ey)
      const drop = Math.max(0.3, top - g)
      const gx = p[0] + sv[i][0] * (half + drop * 1.5) * s
      const gy = p[1] + sv[i][1] * (half + drop * 1.5) * s
      const top3 = [ex, ey, top]
      const g3 = [gx, gy, ground(gx, gy) - 0.3]
      if (s > 0) {
        out.l = top3
        out.gl = g3
      } else {
        out.r = top3
        out.gr = g3
      }
    }
    return { ...out, high: top - ground(p[0], p[1]) }
  })
  for (let i = 1; i < pts.length; i++) {
    const A = edge[i - 1]
    const B = edge[i]
    b.quad(S(A.l[0], A.l[1], A.l[2]), S(B.l[0], B.l[1], B.l[2]), S(B.r[0], B.r[1], B.r[2]), S(A.r[0], A.r[1], A.r[2]), COLOR.ballast)
    if (!slopes) continue
    const slope = (A.high + B.high) / 2 > 1.2 ? COLOR.embankment : COLOR.ballast
    b.quad(S(A.l[0], A.l[1], A.l[2]), S(B.l[0], B.l[1], B.l[2]), S(B.gl[0], B.gl[1], B.gl[2]), S(A.gl[0], A.gl[1], A.gl[2]), slope)
    b.quad(S(A.r[0], A.r[1], A.r[2]), S(B.r[0], B.r[1], B.r[2]), S(B.gr[0], B.gr[1], B.gr[2]), S(A.gr[0], A.gr[1], A.gr[2]), slope)
  }
}

/** 橋桁・高架の床版（上面 = レール面 - 0.3、厚み thick）と、両側の低い壁 */
function addDeck(b: ShapeBatch, pts: number[][], width: number, thick: number, color: string, parapet: number, parapetColor: string, zOf = (p: number[]) => p[2] - 0.3) {
  const sv = sideVectors(pts)
  const h = width / 2
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1]
    const p1 = pts[i]
    const z0 = zOf(p0)
    const z1 = zOf(p1)
    const l0 = [p0[0] + sv[i - 1][0] * h, p0[1] + sv[i - 1][1] * h]
    const l1 = [p1[0] + sv[i][0] * h, p1[1] + sv[i][1] * h]
    const r0 = [p0[0] - sv[i - 1][0] * h, p0[1] - sv[i - 1][1] * h]
    const r1 = [p1[0] - sv[i][0] * h, p1[1] - sv[i][1] * h]
    b.quad(S(l0[0], l0[1], z0), S(l1[0], l1[1], z1), S(r1[0], r1[1], z1), S(r0[0], r0[1], z0), color)
    b.quad(S(l0[0], l0[1], z0 - thick), S(l1[0], l1[1], z1 - thick), S(r1[0], r1[1], z1 - thick), S(r0[0], r0[1], z0 - thick), color)
    for (const [e0, e1] of [
      [l0, l1],
      [r0, r1],
    ]) {
      b.quad(S(e0[0], e0[1], z0 - thick), S(e1[0], e1[1], z1 - thick), S(e1[0], e1[1], z1 + parapet), S(e0[0], e0[1], z0 + parapet), parapet > 0 ? parapetColor : color)
    }
  }
}

/** 柱（下の地面から上 top まで。向き ang・大きさ along × across） */
function addPier(b: ShapeBatch, x: number, y: number, top: number, ang: number, along: number, across: number, color: string) {
  const g = ground(x, y) - 1
  if (top - g < 0.5) return
  const p = S(x, y, (top + g) / 2)
  b.add(BOX, p, color, { rotation: [0, ang, 0], scale: [across, top - g, along] })
}

/**
 * 線の点の列 pts3 を、交通の線路の Path（角をなめらかにした線。電車が走る線）の上の点の列に置き換える（段階 5 の仕上げ。§7 の 111）。
 * 始まりと終わりを Path のいちばん近い点に合わせ、その間の Path の点を使う。離れすぎていれば（6m より）null
 */
function snapToPath(pts3: readonly P3[], path: Path): P3[] | null {
  const near = (p: readonly number[]) => {
    let best = -1
    let bd = Infinity
    for (let i = 0; i < path.x.length; i++) {
      const d = (path.x[i] - p[0]) ** 2 + (path.y[i] - p[1]) ** 2
      if (d < bd) {
        bd = d
        best = i
      }
    }
    return { i: best, d: Math.sqrt(bd) }
  }
  const a = near(pts3[0])
  const c = near(pts3[pts3.length - 1])
  const m = near(pts3[Math.floor(pts3.length / 2)])
  if (a.d > 6 || c.d > 6 || m.d > 6 || a.i === c.i) return null
  const out: P3[] = []
  for (let i = Math.min(a.i, c.i); i <= Math.max(a.i, c.i); i++) out.push([path.x[i], path.y[i], path.z[i]])
  if (a.i > c.i) out.reverse()
  return out
}

function addRails(b: ShapeBatch, infra: TownInfra) {
  const railPath = infra.transit?.rail ? new Path(infra.transit.rail.pts, 2, false) : null
  for (const r of infra.rails) {
    const width = r.tracks * 4.0 + 1.6
    if (r.structure === 'at_grade' || r.structure === 'embankment') addBallast(b, r.pts, r.tracks)
    else if (r.structure === 'concrete_viaduct' || r.structure === 'bridge') {
      const pts = densify(r.pts, 10)
      addDeck(b, pts, width + 1.2, 1.4, r.structure === 'bridge' ? COLOR.girder : COLOR.concrete, 1.1, COLOR.viaductDark)
      addBallast(b, r.pts, r.tracks, false)
      const span = r.structure === 'bridge' ? 25 : 20
      const total = pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0)
      for (let s = 0; s <= total; s += span) {
        const at = pointAt(pts, s)
        addPier(b, at.x, at.y, at.z - 1.7, at.yaw, 1.6, width - 1.5, COLOR.viaductDark)
      }
    } else if (r.structure === 'stone_arch_viaduct') {
      // 灯町の石造アーチは曲線なので、折れ線のままだと電車の走る線（なめらかな Path）と数十 cm ずれる。Path の上の点で作る
      const pts = (railPath && snapToPath(r.pts, railPath)) || r.pts
      addArchViaduct(b, pts, width + 1.4, Math.max(1, r.arches))
    }
  }
  for (const t of infra.tracks) addBallast(b, t.pts, 1)
  for (const p of infra.platforms) {
    const ring = p.ring
    const n = ring.length
    for (let i = 0; i < n; i++) {
      const a = ring[i]
      const c = ring[(i + 1) % n]
      b.quad(S(a[0], a[1], ground(a[0], a[1]) - 0.5), S(c[0], c[1], ground(c[0], c[1]) - 0.5), S(c[0], c[1], p.top), S(a[0], a[1], p.top), COLOR.platform)
    }
    const tris = THREE.ShapeUtils.triangulateShape(
      ring.map((q) => new THREE.Vector2(q[0], q[1])),
      [],
    )
    for (const t of tris) {
      b.tri(S(ring[t[0]][0], ring[t[0]][1], p.top), S(ring[t[1]][0], ring[t[1]][1], p.top), S(ring[t[2]][0], ring[t[2]][1], p.top), COLOR.platform)
      if (p.roof) b.tri(S(ring[t[0]][0], ring[t[0]][1], p.top + 3.8), S(ring[t[1]][0], ring[t[1]][1], p.top + 3.8), S(ring[t[2]][0], ring[t[2]][1], p.top + 3.8), COLOR.canopy)
    }
  }
}

/** 折れ線の上の長さ s の点（x, y, z と向き） */
export function pointAt(pts: number[][], s: number) {
  let acc = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const c = pts[i]
    const len = Math.hypot(c[0] - a[0], c[1] - a[1])
    if (acc + len >= s || i === pts.length - 1) {
      const t = len > 0 ? Math.min(1, Math.max(0, (s - acc) / len)) : 0
      const dx = c[0] - a[0]
      const dy = c[1] - a[1]
      // シーンの Y 軸まわり: 形の +z（奥行き）を進む向き（シーンの (dx, 0, -dy)）へ
      const yaw = Math.atan2(dx, -dy)
      return { x: a[0] + dx * t, y: a[1] + dy * t, z: a[2] + (c[2] - a[2]) * t, yaw, dir: [dx / (len || 1), dy / (len || 1)] }
    }
    acc += len
  }
  const p = pts[pts.length - 1]
  return { x: p[0], y: p[1], z: p[2], yaw: 0, dir: [1, 0] }
}

/** 石造アーチの高架（灯町高架。煉瓦と石。アーチの下は店 = 建物のデータ） */
function addArchViaduct(b: ShapeBatch, pts3: readonly P3[], width: number, arches: number) {
  const pts = densify(pts3, 4)
  const total = pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0)
  addDeck(b, pts, width, 1.0, COLOR.brickDark, 1.0, COLOR.brick)
  addBallast(b, pts3, 2, false)
  const bay = total / arches
  const pier = Math.min(2.6, bay * 0.22)
  const h = width / 2
  for (let k = 0; k <= arches; k++) {
    const at = pointAt(pts, k * bay)
    addPier(b, at.x, at.y, at.z - 1.3, at.yaw, pier, width, COLOR.brick)
  }
  // アーチ（半円。両側の面の、アーチと床版のあいだの壁と、アーチの内側）
  const N = 8
  for (let k = 0; k < arches; k++) {
    const s0 = k * bay + pier / 2
    const s1 = (k + 1) * bay - pier / 2
    const open = s1 - s0
    const mid = (s0 + s1) / 2
    const atMid = pointAt(pts, mid)
    const deckBottom = atMid.z - 1.3
    const spring = deckBottom - open / 2 - 0.7
    const arc: { s: number; z: number }[] = []
    for (let i = 0; i <= N; i++) {
      const th = Math.PI - (i / N) * Math.PI
      arc.push({ s: mid + Math.cos(th) * (open / 2), z: spring + Math.sin(th) * (open / 2) })
    }
    for (let i = 1; i <= N; i++) {
      const a = pointAt(pts, arc[i - 1].s)
      const c = pointAt(pts, arc[i].s)
      const sa = [-a.dir[1], a.dir[0]]
      const sc = [-c.dir[1], c.dir[0]]
      for (const s of [1, -1]) {
        const ax = a.x + sa[0] * h * s
        const ay = a.y + sa[1] * h * s
        const cx = c.x + sc[0] * h * s
        const cy = c.y + sc[1] * h * s
        b.quad(S(ax, ay, arc[i - 1].z), S(cx, cy, arc[i].z), S(cx, cy, deckBottom), S(ax, ay, deckBottom), COLOR.brick)
      }
      // アーチの内側（天井）
      b.quad(S(a.x + sa[0] * h, a.y + sa[1] * h, arc[i - 1].z), S(c.x + sc[0] * h, c.y + sc[1] * h, arc[i].z), S(c.x - sc[0] * h, c.y - sc[1] * h, arc[i].z), S(a.x - sa[0] * h, a.y - sa[1] * h, arc[i - 1].z), COLOR.brickDark)
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 道の橋・ケーブル                                                               */
/* -------------------------------------------------------------------------- */

function addBridges(b: ShapeBatch, infra: TownInfra) {
  for (const br of infra.bridges) {
    const pts = densify(br.pts, 6)
    const color = br.stone ? COLOR.bridgeStone : COLOR.bridgeConcrete
    addDeck(b, pts, br.width, 0.9, color, 1.0, color, (p) => (br.deck ?? p[2]) + 0.05)
  }
}

/** ケーブルの線路（路盤と、地面から浮いた所の脚）と、線路沿いの灯り */
function addCable(b: ShapeBatch, infra: TownInfra, lights: LightItem[]) {
  const c = infra.cable
  if (!c) return
  for (const line of [c.pts, ...c.loops]) {
    const pts = densify(line, 8)
    const sv = sideVectors(pts)
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1]
      const p1 = pts[i]
      // 麓駅の車止めより下（ふもとの道と駅前の上）は作らない（D-055）
      if (Math.max(cableUL(p0[0], p0[1])[0], cableUL(p1[0], p1[1])[0]) < CABLE_TRACK_FROM) continue
      const h = 1.6
      b.quad(
        S(p0[0] + sv[i - 1][0] * h, p0[1] + sv[i - 1][1] * h, p0[2] - 0.15),
        S(p1[0] + sv[i][0] * h, p1[1] + sv[i][1] * h, p1[2] - 0.15),
        S(p1[0] - sv[i][0] * h, p1[1] - sv[i][1] * h, p1[2] - 0.15),
        S(p0[0] - sv[i - 1][0] * h, p0[1] - sv[i - 1][1] * h, p0[2] - 0.15),
        COLOR.cableBed,
      )
      const g = ground(p0[0], p0[1])
      if (p0[2] - g > 0.8 && i % 2 === 0) addPier(b, p0[0], p0[1], p0[2] - 0.6, 0, 0.6, 2.4, COLOR.cableLeg)
    }
  }
  // 線路沿いの灯り（20m ごと）
  const pts = densify(c.pts, 20)
  pts.forEach((p, i) => {
    if (cableUL(p[0], p[1])[0] < CABLE_TRACK_FROM) return
    if (i % 1 === 0) lights.push({ x: p[0], y: p[1], z: p[2] + 1.8, kind: LIGHT_KIND.cable, color: '#ffc275', size: 0.9, power: 1.1, seed: (i * 0.37) % 0.8 })
  })
}

/* -------------------------------------------------------------------------- */
/* 形の決まった構造物                                                              */
/* -------------------------------------------------------------------------- */

function addStructures(b: ShapeBatch, list: TownStructure[], lights: LightItem[], namedShapes: boolean) {
  for (const s of list) {
    // 名前のある建物の外観（named/structures.ts）が作る構造物は、ここでは形を作らない（灯台の閃光の灯りだけ残す）
    if (namedShapes) {
      if (s.type === 'lighthouse' && !s.main) lights.push({ x: s.x, y: s.y, z: s.focal, kind: LIGHT_KIND.beacon, color: s.color === 'red' ? '#ff4a3a' : '#4aff8a', size: 2.6, power: 3.2, seed: s.color === 'red' ? 0.05 : 0.55 })
      if (s.type === 'crane' || s.type === 'lighthouse' || s.type === 'monument' || s.type === 'belfry' || s.type === 'lamppost' || s.type === 'gate' || s.type === 'statue') continue
    }
    if (s.type === 'crane') {
      // ガントリークレーン（赤と白）: 4 本の脚・上の桁・海へ張り出す腕・機械室
      const ux = [Math.cos(s.axis), Math.sin(s.axis)]
      const uy = [-Math.sin(s.axis), Math.cos(s.axis)]
      const legs: [number, number][] = [
        [-0.5, -0.5],
        [0.5, -0.5],
        [0.5, 0.5],
        [-0.5, 0.5],
      ]
      const gh = s.height - 8
      for (const [a, c] of legs) {
        const x = s.x + ux[0] * a * s.w + uy[0] * c * s.d
        const y = s.y + ux[1] * a * s.w + uy[1] * c * s.d
        b.add(BOX, S(x, y, s.z + gh / 2), COLOR.craneRed, { scale: [1.4, gh, 1.4] })
      }
      const yawAxis = -s.axis
      b.add(BOX, S(s.x, s.y, s.z + gh), COLOR.craneWhite, { rotation: [0, yawAxis, 0], scale: [s.w + 3, 2.6, s.d + 3] })
      const bx = [Math.cos(s.boom), Math.sin(s.boom)]
      const reach = 48
      const back = s.d / 2 + 14
      const mid = (reach - back) / 2
      b.add(BOX, S(s.x + bx[0] * mid, s.y + bx[1] * mid, s.z + gh + 3), COLOR.craneRed, { rotation: [0, -s.boom, 0], scale: [reach + back, 2.4, 2.6] })
      b.add(BOX, S(s.x, s.y, s.z + gh + 6.5), COLOR.craneWhite, { rotation: [0, yawAxis, 0], scale: [8, 5, 7] })
      lights.push({ x: s.x + bx[0] * reach, y: s.y + bx[1] * reach, z: s.z + gh + 5, kind: LIGHT_KIND.aviation, color: '#ff3a2a', size: 1.6, power: 1.4, seed: 0.15 })
      lights.push({ x: s.x, y: s.y, z: s.z + gh - 2, kind: LIGHT_KIND.port, color: '#ffdcae', size: 2.6, power: 1.8, seed: 0.1 })
    } else if (s.type === 'lighthouse') {
      const color = s.color === 'red' ? '#c0392b' : '#f2f1ec'
      b.add(CYL16, S(s.x, s.y, s.z + s.height / 2), color, { scale: [s.r * 2, s.height, s.r * 2] })
      b.add(CYL16, S(s.x, s.y, s.z + s.height + 1), '#1c1e22', { scale: [s.r * 1.4, 2, s.r * 1.4], emit: ['#fff4d8', 2] })
      b.add(CONE16, S(s.x, s.y, s.z + s.height + 2.8), '#1c1e22', { scale: [s.r * 1.6, 1.6, s.r * 1.6] })
      if (!s.main) lights.push({ x: s.x, y: s.y, z: s.focal, kind: LIGHT_KIND.beacon, color: s.color === 'red' ? '#ff4a3a' : '#4aff8a', size: 2.6, power: 3.2, seed: s.color === 'red' ? 0.05 : 0.55 })
    } else if (s.type === 'parabola') {
      // 大パラボラはラボの前のセットで細かく作る（site/parabola.ts。§7 の 31）
    } else if (s.type === 'monument') {
      b.add(CYL16, S(s.x, s.y, s.z + (s.height - 3) / 2), '#d6cfbf', { scale: [s.r * 2, s.height - 3, s.r * 2] })
      b.add(CONE16, S(s.x, s.y, s.z + s.height - 1.5), '#4f8f7a', { scale: [s.r * 2.2, 3, s.r * 2.2] })
    } else if (s.type === 'belfry') {
      const yaw = -s.axis
      for (const [a, c] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        const x = s.x + Math.cos(s.axis) * a * (s.w / 2 - 0.4) - Math.sin(s.axis) * c * (s.d / 2 - 0.4)
        const y = s.y + Math.sin(s.axis) * a * (s.w / 2 - 0.4) + Math.cos(s.axis) * c * (s.d / 2 - 0.4)
        b.add(BOX, S(x, y, s.z + (s.height - 3) / 2), '#4a3a2c', { scale: [0.5, s.height - 3, 0.5] })
      }
      const roof = new THREE.ConeGeometry(0.72, 1, 4).rotateY(Math.PI / 4)
      b.add(roof, S(s.x, s.y, s.z + s.height - 1.5), '#7d8085', { rotation: [0, yaw, 0], scale: [s.w * 1.4, 3, s.d * 1.4] })
    } else if (s.type === 'lamppost') {
      b.add(CYL16, S(s.x, s.y, s.z + s.height / 2), '#2a2c2e', { scale: [0.25, s.height, 0.25] })
      b.add(BOX, S(s.x, s.y, s.z + s.height + 0.3), '#f4ead0', { scale: [0.6, 0.6, 0.6], emit: ['#fff1d6', 2] })
      lights.push({ x: s.x, y: s.y, z: s.z + s.height + 0.3, kind: LIGHT_KIND.street, color: '#fff1d6', size: 1.1, power: 1.8, seed: 0.05 })
    } else if (s.type === 'gate') {
      const [a, c] = [s.pts[0], s.pts[s.pts.length - 1]]
      for (const p of [a, c]) b.add(BOX, S(p[0], p[1], s.z + s.height / 2), '#9a8f80', { scale: [0.8, s.height, 0.8] })
    } else if (s.type === 'statue') {
      b.add(BOX, S(s.x, s.y, s.z + 1), '#b9b2a4', { scale: [s.r * 1.6, 2, s.r * 1.6] })
      b.add(BOX, S(s.x, s.y, s.z + 2 + (s.height - 2) / 2), '#55644d', { scale: [0.8, s.height - 2, 0.6] })
    }
  }
}

/** 構造物をまとめた形と、それに付く灯り（namedShapes = 名前のある構造物の形は named/ が作る。stairs = 町の石段（world/walk/townWalk.ts）） */
export function buildInfraGeometry(infra: TownInfra, namedShapes = false, stairs: StairIndex | null = null) {
  const b = new ShapeBatch()
  const lights: LightItem[] = []
  addWalls(b, infra)
  addRails(b, infra)
  addBridges(b, infra)
  const stairParts = addTownStairs(b, stairs)
  addCable(b, infra, lights)
  addStructures(b, infra.structures, lights, namedShapes)
  return { geometry: b.build(), lights, stairShrubs: stairParts.shrubs, stairLights: stairParts.lights }
}

/** 川・運河・池・小川の水面 */
export function buildWaterGeometry(infra: TownInfra) {
  const pos: number[] = []
  const w = infra.water
  for (let i = 0; i < w.pos.length; i += 3) pos.push(...S(w.pos[i], w.pos[i + 1], w.pos[i + 2] + 0.02))
  const idx = [...w.idx]
  for (const st of infra.streams) {
    const pts = densify(st.pts, 4)
    const sv = sideVectors(pts)
    const h = st.width / 2 + 0.3
    const base = pos.length / 3
    pts.forEach((p, i) => {
      pos.push(...S(p[0] + sv[i][0] * h, p[1] + sv[i][1] * h, p[2] + 0.05))
      pos.push(...S(p[0] - sv[i][0] * h, p[1] - sv[i][1] * h, p[2] + 0.05))
    })
    for (let i = 1; i < pts.length; i++) {
      const a = base + (i - 1) * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeBoundingSphere()
  return g
}

/** 観覧車ソラノワとガーデンドーム（専用のシェーダー）の置き方 */
export function structurePlacements(list: TownStructure[]) {
  const soranowa = list.find((s): s is Extract<TownStructure, { type: 'soranowa' }> => s.type === 'soranowa') ?? null
  const dome = list.find((s): s is Extract<TownStructure, { type: 'gardenDome' }> => s.type === 'gardenDome') ?? null
  const lighthouse = list.find((s): s is Extract<TownStructure, { type: 'lighthouse' }> => s.type === 'lighthouse' && s.main) ?? null
  return { soranowa, dome, lighthouse }
}

/** ガーデンドームの不透明なガラスの形（中を作っている間は隠し、中の透けるガラスのドームに替える。interior/briefs/dome） */
export const gardenDomeShell = { mesh: null as THREE.Mesh | null }

export function gardenDomeMesh(s: Extract<TownStructure, { type: 'gardenDome' }>, material: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 20, 0, Math.PI * 2, 0, Math.PI / 2), material)
  mesh.position.set(...S(s.x, s.y, s.z - 0.5))
  mesh.scale.set(s.r, s.height, s.r)
  mesh.name = 'gardenDome'
  gardenDomeShell.mesh = mesh
  return mesh
}
