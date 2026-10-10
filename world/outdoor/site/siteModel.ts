import { SITE } from '../../../core/town'
import {
  DOOR,
  ENTRY_STAIR,
  LOOKOUT,
  LOOKOUT_BENCHES,
  LOOKOUT_SCOPE,
  OUTDOOR_OBSTACLES,
  PARABOLA_PAD,
  PATH_MESH_RADIUS,
  PATH_REROUTE,
  RAMP,
  SHELL,
  SITE_PATHS,
  STAIR_BOTTOM,
  TERRACE,
  WEST_LANDING,
  WALK_AREAS,
  insideLab,
  surfaceOf,
  type SurfaceKind,
  type WalkArea,
  type XZ,
} from '../../../core/site'
import { naturalHeight } from '../town/heights'
import { namedGrade } from '../named/grade'
import { townData } from '../town/townData'
import { stairGrade } from '../../../core/walk/stairGrade'

/**
 * ラボのまわりのセットの「形の決まり」（描く形・花音の通り道・地面の高さ・カメラが共有する）。
 *
 * - 小道: 作り直した小道（core/site.ts の SITE_PATHS）と、地図データの道（infra.site。ラボから PATH_MESH_RADIUS m まで。付け替えは PATH_REROUTE）。
 *   中心線を 1m ごとに区切り、地形の高さを前後になめらかにした「道の高さ」を持つ。決めた面（テラス・石段・スロープ・見晴らし台）や
 *   先に作った小道に端が触れていれば、その高さに合わせる（段差なくつながる）
 * - 地形を均す（gradeElevation）: 建物・テラス・石段・スロープの下は面より下げ、小道の下は道の高さに（横の傾きをなくす）、
 *   見晴らし台は 110.0m の平らな台に（山側はなだらかに、谷側は擁壁）
 * - 地面の高さ（groundY）: 花音の足元・KB-001・カメラが使う。石段は体の高さ用のなめらかな坂（stepY が段そのもの）
 *
 * 町の地図データが読めるまでは、作り直した小道と決めた面だけ（地形の高さは仮に床の 1.3m 下）。読めたら build() で作り直す（version が増える）
 */

const LAB = SITE.labFloorElevation

/** 花音の通り道に入れる小道の範囲（ラボから m） */
export const NAV_RADIUS = 135
/** 地形を均す範囲の外の縁（小道の中心からの距離 = 幅の半分 + これ） */
const BLEND = 2.2
/** 空間の索引の升目（m） */
const CELL = 6

export interface LivePath {
  id: string
  name: string | null
  /** 中心線（シーンの x, z） */
  pts: XZ[]
  width: number
  surface: SurfaceKind
  curb: boolean
  /** 街灯の間隔（m。0 なら置かない） */
  lampEvery: number
  fromData: boolean
  /** 1m ごとの点（シーンの x, z と、道の面の高さ y）と、始めからの長さ */
  sx: number[]
  sz: number[]
  sy: number[]
  cum: number[]
}

export interface SiteLamp {
  x: number
  z: number
  /** 根元の高さ（シーンの y） */
  y: number
  /** 柱の高さ（m） */
  h: number
  /** 腕の向き（rad。灯具が道の側へ出る） */
  yaw: number
}

export interface SiteObstacle {
  kind: 'rect' | 'circle'
  min?: XZ
  max?: XZ
  center?: XZ
  radius?: number
  height: number
  name: string
}

interface SegRef {
  p: number
  i: number
}

export interface PathHit {
  path: LivePath
  /** 中心線からの距離（m） */
  d: number
  /** 道の面の高さ（シーンの y） */
  y: number
  /** 中心線の向き（単位ベクトル x, z） */
  tx: number
  tz: number
}

const smooth01 = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** 町の高さ画像の地面（シーンの y、均す前）。データが無いときは床の 1.3m 下 */
export function naturalY(x: number, z: number) {
  return townData.overview ? naturalHeight(x, -z) - LAB : -1.3
}

/** 石段の体の高さ（なめらかな坂。z = 石段の上の縁からの位置） */
function stairSmoothY(z: number) {
  const t = ENTRY_STAIR.tread
  const k = (z - (ENTRY_STAIR.z0 - t / 2)) / (ENTRY_STAIR.risers * t + t)
  return TERRACE.y + (STAIR_BOTTOM.y - TERRACE.y) * Math.min(1, Math.max(0, k))
}
/** 石段の段そのものの高さ */
function stairStepY(z: number) {
  if (z <= ENTRY_STAIR.z0) return TERRACE.y
  const k = Math.min(ENTRY_STAIR.risers, Math.ceil((z - ENTRY_STAIR.z0) / ENTRY_STAIR.tread))
  return TERRACE.y - k * ENTRY_STAIR.rise
}
/** スロープの高さ */
export function rampY(x: number) {
  const k = Math.min(1, Math.max(0, (x - RAMP.x0) / (RAMP.x1 - RAMP.x0)))
  return RAMP.y0 + (RAMP.y1 - RAMP.y0) * k
}

const inRect = (x: number, z: number, x0: number, x1: number, z0: number, z1: number) => x >= x0 && x <= x1 && z >= z0 && z <= z1

/** 決めた面（テラス・通用口の前の踊り場・扉の敷居・石段・スロープ・見晴らし台）の高さ。面の外なら null。step = 石段を段のまま */
export function designedY(x: number, z: number, step = false): number | null {
  if (Math.abs(x - DOOR.x) < DOOR.width / 2 + 0.05 && z >= SHELL.glassZ - 0.05 && z <= SHELL.portalZ + 0.1) return 0
  if (inRect(x, z, TERRACE.x0, TERRACE.x1, TERRACE.z0, TERRACE.z1)) return TERRACE.y
  if (inRect(x, z, WEST_LANDING.x0, WEST_LANDING.x1, WEST_LANDING.z0, WEST_LANDING.z1)) return WEST_LANDING.y
  if (inRect(x, z, ENTRY_STAIR.x0, ENTRY_STAIR.x1, ENTRY_STAIR.z0, STAIR_BOTTOM.z)) return step ? stairStepY(z) : stairSmoothY(z)
  if (inRect(x, z, RAMP.x0, RAMP.x1, RAMP.z0, RAMP.z1)) return rampY(x)
  if (Math.hypot(x - LOOKOUT.center[0], z - LOOKOUT.center[1]) < LOOKOUT.radius) return LOOKOUT.y
  return null
}

class SiteModel {
  /** 作り直すたびに増える（通り道のグラフなどの作り直しの合図） */
  version = 0
  /** 地図データ（地形・道）を使って作ったか */
  ready = false
  paths: LivePath[] = []
  lamps: SiteLamp[] = []
  obstacles: SiteObstacle[] = []
  /** 大パラボラの前の広場の高さ（シーンの y） */
  padY = -1.0
  private grid = new Map<number, SegRef[]>()

  constructor() {
    this.build()
  }

  /** 作る（町の地図データを読み終えたら、もう一度呼ぶ） */
  build() {
    this.ready = !!townData.overview
    this.paths = []
    this.grid.clear()
    for (const p of SITE_PATHS) this.addPath({ id: p.id, name: null, pts: p.pts, width: p.width, surface: p.surface, curb: p.curb, lampEvery: p.lamps, fromData: false })
    for (const d of townData.infra?.site?.paths ?? []) {
      if (d.cls !== 'path' && d.cls !== 'local') continue
      const re = PATH_REROUTE[d.id]
      if (re?.drop) continue
      let pts: XZ[] = d.pts.map((q) => [q[0], -q[1]] as XZ)
      if (re?.head) pts = [...re.head, ...pts.slice(1)]
      if (re?.end) pts = [...pts.slice(0, -1), re.end]
      if (re?.extend) pts = [...pts, ...re.extend]
      // ラボから PATH_MESH_RADIUS m まで（外へ出る区間は、外の最初の点まで残して切る）
      const clipped: XZ[] = []
      for (let i = 0; i < pts.length; i++) {
        const inside = Math.hypot(pts[i][0], pts[i][1]) < PATH_MESH_RADIUS
        const nextIn = i + 1 < pts.length && Math.hypot(pts[i + 1][0], pts[i + 1][1]) < PATH_MESH_RADIUS
        const prevIn = i > 0 && Math.hypot(pts[i - 1][0], pts[i - 1][1]) < PATH_MESH_RADIUS
        if (inside || nextIn || prevIn) clipped.push(pts[i])
        else if (clipped.length >= 2) break
      }
      if (clipped.length < 2) continue
      const surface = surfaceOf(d.surface, d.cls)
      const lampEvery = d.cls === 'path' ? 16 : 22
      this.addPath({ id: d.id, name: d.name, pts: clipped, width: d.width, surface, curb: true, lampEvery, fromData: true })
    }
    this.padY = naturalY(PARABOLA_PAD.center[0], PARABOLA_PAD.center[1])
    this.placeLamps()
    this.obstacles = [
      ...OUTDOOR_OBSTACLES.map((o) => ({ kind: 'rect' as const, min: o.min, max: o.max, height: o.height, name: o.name })),
      ...this.lamps.map((l) => ({ kind: 'circle' as const, center: [l.x, l.z] as XZ, radius: 0.16, height: l.h, name: '街灯' })),
      ...LOOKOUT_BENCHES.map((b) => {
        const [x, z] = lookoutPoint(b.angle, b.dist)
        return { kind: 'circle' as const, center: [x, z] as XZ, radius: 1.0, height: 0.45, name: '見晴らし台のベンチ' }
      }),
      (() => {
        const [x, z] = lookoutPoint(LOOKOUT_SCOPE.angle, LOOKOUT_SCOPE.dist)
        return { kind: 'circle' as const, center: [x, z] as XZ, radius: 0.35, height: 1.3, name: '望遠鏡' }
      })(),
    ]
    this.version++
  }

  private addPath(p: Omit<LivePath, 'sx' | 'sz' | 'sy' | 'cum'>) {
    // 1m ごとの点
    const sx: number[] = []
    const sz: number[] = []
    const cum: number[] = []
    let acc = 0
    for (let i = 0; i < p.pts.length; i++) {
      const [x, z] = p.pts[i]
      if (i === 0) {
        sx.push(x)
        sz.push(z)
        cum.push(0)
        continue
      }
      const [ax, az] = p.pts[i - 1]
      const len = Math.hypot(x - ax, z - az)
      const n = Math.max(1, Math.ceil(len / 1.0))
      for (let k = 1; k <= n; k++) {
        sx.push(ax + ((x - ax) * k) / n)
        sz.push(az + ((z - az) * k) / n)
        cum.push(acc + (len * k) / n)
      }
      acc += len
    }
    // 道の高さ: 地形の高さを前後 ±3m でならす
    const raw = sx.map((x, i) => naturalY(x, sz[i]))
    const sy = raw.map((_, i) => {
      let s = 0
      let w = 0
      for (let k = -3; k <= 3; k++) {
        const j = Math.min(raw.length - 1, Math.max(0, i + k))
        const wk = 4 - Math.abs(k)
        s += raw[j] * wk
        w += wk
      }
      return s / w
    })
    // 端が決めた面か、先に作った小道に触れていれば、その高さに合わせる（10m かけて元の高さへ戻す）
    const pin = (end: 0 | 1) => {
      const i = end === 0 ? 0 : sx.length - 1
      const x = sx[i]
      const z = sz[i]
      let y = designedY(x, z)
      if (y === null) {
        const hit = this.pathAt(x, z, 1.6)
        if (hit) y = hit.y
      }
      if (y === null) return
      const dy = y - sy[i]
      const s0 = cum[i]
      for (let k = 0; k < sy.length; k++) sy[k] += dy * (1 - smooth01(0, 10, Math.abs(cum[k] - s0)))
    }
    pin(0)
    pin(1)
    // 石段の下（作り直した lab-front）は、石段のいちばん下の段より 3cm 低く（いちばん下の踏み石が道に少しかかる）
    if (p.id === 'lab-front') {
      let best = 0
      for (let k = 1; k < sx.length; k++) if (Math.abs(sx[k] - DOOR.x) < Math.abs(sx[best] - DOOR.x)) best = k
      const dy = STAIR_BOTTOM.y - 0.03 - sy[best]
      for (let k = 0; k < sy.length; k++) sy[k] += dy * (1 - smooth01(0, 9, Math.abs(cum[k] - cum[best])))
    }
    const live: LivePath = { ...p, sx, sz, sy, cum }
    const index = this.paths.length
    this.paths.push(live)
    // 索引に入れる
    const pad = p.width / 2 + BLEND + 0.5
    for (let i = 1; i < sx.length; i++) {
      const x0 = Math.floor((Math.min(sx[i - 1], sx[i]) - pad) / CELL)
      const x1 = Math.floor((Math.max(sx[i - 1], sx[i]) + pad) / CELL)
      const z0 = Math.floor((Math.min(sz[i - 1], sz[i]) - pad) / CELL)
      const z1 = Math.floor((Math.max(sz[i - 1], sz[i]) + pad) / CELL)
      for (let gx = x0; gx <= x1; gx++)
        for (let gz = z0; gz <= z1; gz++) {
          const key = gx * 100003 + gz
          let list = this.grid.get(key)
          if (!list) this.grid.set(key, (list = []))
          list.push({ p: index, i })
        }
    }
  }

  /** いちばん近い小道（中心線から maxEdge = 幅の半分 + maxEdge m まで）。無ければ null */
  pathAt(x: number, z: number, maxEdge = BLEND): PathHit | null {
    const list = this.grid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL))
    if (!list) return null
    let best: PathHit | null = null
    let bestEdge = maxEdge
    for (const r of list) {
      const p = this.paths[r.p]
      const ax = p.sx[r.i - 1]
      const az = p.sz[r.i - 1]
      const bx = p.sx[r.i]
      const bz = p.sz[r.i]
      const dx = bx - ax
      const dz = bz - az
      const l2 = dx * dx + dz * dz || 1e-9
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2))
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t))
      const edge = d - p.width / 2
      if (edge < bestEdge) {
        bestEdge = edge
        const l = Math.sqrt(l2)
        best = { path: p, d, y: p.sy[r.i - 1] + (p.sy[r.i] - p.sy[r.i - 1]) * t, tx: dx / l, tz: dz / l }
      }
    }
    return best
  }

  /** 街灯（作り直した小道と、ラボから 150m までの地図の小道。左右を互い違いに）と、見晴らし台・スロープの灯り */
  private placeLamps() {
    const lamps: SiteLamp[] = []
    const near = (x: number, z: number) => lamps.some((l) => Math.hypot(l.x - x, l.z - z) < 7)
    for (const p of this.paths) {
      if (!p.lampEvery) continue
      let side = 1
      for (let s = p.lampEvery * 0.5; s < p.cum[p.cum.length - 1]; s += p.lampEvery) {
        let i = 1
        while (i < p.cum.length - 1 && p.cum[i] < s) i++
        const k = (s - p.cum[i - 1]) / Math.max(1e-6, p.cum[i] - p.cum[i - 1])
        const cx = p.sx[i - 1] + (p.sx[i] - p.sx[i - 1]) * k
        const cz = p.sz[i - 1] + (p.sz[i] - p.sz[i - 1]) * k
        if (Math.hypot(cx, cz) > 150) continue
        const tx = p.sx[i] - p.sx[i - 1]
        const tz = p.sz[i] - p.sz[i - 1]
        const tl = Math.hypot(tx, tz) || 1
        const nx = -tz / tl
        const nz = tx / tl
        const off = p.width / 2 + 0.45
        const x = cx + nx * off * side
        const z = cz + nz * off * side
        // 灯具の腕は道の側へ
        const yaw = Math.atan2(-nx * side, -nz * side)
        side = -side
        // 決めた面の上・ほかの道の上・ラボのまわりには置かない
        if (designedY(x, z) !== null || insideLab(x, z, 1.2) || near(x, z)) continue
        const other = this.pathAt(x, z, 0.2)
        if (other && other.path !== p) continue
        lamps.push({ x, z, y: naturalYGraded(this, x, z), h: 3.4, yaw })
      }
    }
    // スロープの北の縁（上と下）と、見晴らし台の縁
    lamps.push({ x: RAMP.x0 + 3.2, z: RAMP.z0 - 0.35, y: rampY(RAMP.x0 + 3.2), h: 3.4, yaw: 0 })
    lamps.push({ x: RAMP.x1 - 2.0, z: RAMP.z0 - 0.35, y: rampY(RAMP.x1 - 2.0), h: 3.4, yaw: 0 })
    for (const a of [-1.85, 2.2]) {
      const [x, z] = lookoutPoint(a, LOOKOUT.radius - 0.6)
      lamps.push({ x, z, y: LOOKOUT.y, h: 3.6, yaw: Math.atan2(LOOKOUT.center[0] - x, LOOKOUT.center[1] - z) })
    }
    this.lamps = lamps
  }

  /** 地形を均した標高（平面座標 x, y と、均す前の標高 h。m）。terrain.ts の terrainHeight が使う */
  grade(x: number, y: number, h: number) {
    const z = -y
    // ラボの殻・テラス・石段・スロープの下は面より下げる（形の縁から少し内側まで）
    if (x > -SHELL.outerX - 0.05 && x < SHELL.outerX + 0.05 && z > SHELL.northOuter - 0.05 && z < SHELL.portalZ + 0.05) return Math.min(h, LAB - 1.0)
    // （下げるだけで上げない。上げると、格子の 1 升ぶん外へはみ出した坂が擁壁の外に見えるため）
    if (inRect(x, z, TERRACE.x0 - 0.05, TERRACE.x1 + 0.05, TERRACE.z0, TERRACE.z1 - 0.2)) return Math.min(h, LAB + TERRACE.y - 0.45)
    if (inRect(x, z, WEST_LANDING.x0 - 0.05, WEST_LANDING.x1 + 0.05, WEST_LANDING.z0 + 0.2, WEST_LANDING.z1)) return Math.min(h, LAB + WEST_LANDING.y - 0.45)
    if (inRect(x, z, ENTRY_STAIR.x0 + 0.15, ENTRY_STAIR.x1 - 0.15, ENTRY_STAIR.z0 - 0.3, STAIR_BOTTOM.z - 0.1)) return Math.min(h, LAB + stairStepY(z) - 0.3)
    if (inRect(x, z, RAMP.x0 - 0.3, RAMP.x1 - 0.15, RAMP.z0 + 0.12, RAMP.z1 - 0.12)) return Math.min(h, LAB + rampY(x) - 0.3)
    // 見晴らし台: 台の上は 110.0m、山側（地面が高い所）はなだらかにつなぐ。谷側は擁壁（形）が受ける
    const dl = Math.hypot(x - LOOKOUT.center[0], z - LOOKOUT.center[1])
    if (dl < LOOKOUT.radius + 14) {
      // 高さ画像の見晴らし台のまわりには、広場の標高の点（110.0m・112m 台）が針のように残っているので、まわりの平均にならす
      let acc = 0
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) acc += naturalHeight(x + i * 2.5, y + j * 2.5)
      const smoothH = acc / 25
      h = h + (smoothH - h) * (1 - smooth01(LOOKOUT.radius + 9, LOOKOUT.radius + 14, dl))
    }
    if (dl < LOOKOUT.radius + 6) {
      const top = LAB + LOOKOUT.y
      if (dl < LOOKOUT.radius - 0.35) return top - 0.05
      if (h > top) return top + (h - top) * smooth01(LOOKOUT.radius - 0.35, LOOKOUT.radius + 6, dl)
      return h
    }
    // 大パラボラの前の広場
    const dp = Math.hypot(x - PARABOLA_PAD.center[0], z - PARABOLA_PAD.center[1])
    if (dp < PARABOLA_PAD.radius + 2.5) {
      const top = LAB + this.padY - 0.03
      return top + (h - top) * smooth01(PARABOLA_PAD.radius, PARABOLA_PAD.radius + 2.5, dp)
    }
    // 小道: 道の幅は道の高さ（少し下げる）に、その外は BLEND m でもとの地形へ
    const hit = this.pathAt(x, z)
    if (hit) {
      const target = LAB + hit.y - 0.05
      const w = hit.path.width / 2
      return target + (h - target) * smooth01(w + 0.2, w + BLEND, hit.d)
    }
    return h
  }

  /** 花音の足元の高さ（シーンの y）。ラボの中は床（立ち位置の台は locomotion が足す）。step = 石段を段のまま（足の高さ用） */
  groundY(x: number, z: number, step = false) {
    if (insideLab(x, z)) return 0
    const d = designedY(x, z, step)
    if (d !== null) return d
    const hit = this.pathAt(x, z, 0)
    if (hit && hit.d <= hit.path.width / 2) return hit.y
    if (Math.hypot(x - PARABOLA_PAD.center[0], z - PARABOLA_PAD.center[1]) < PARABOLA_PAD.radius) return this.padY
    return naturalYGraded(this, x, z)
  }

  /** 外の点が歩ける所か（決めた面・小道の上で、縁と障害物から clearance m 以上離れている） */
  walkable(x: number, z: number, clearance: number) {
    let ok = false
    for (const a of WALK_AREAS) {
      if (areaMargin(a, x, z) >= clearance) {
        ok = true
        break
      }
    }
    if (!ok) {
      const hit = this.pathAt(x, z, 0)
      if (hit && Math.hypot(x, z) < NAV_RADIUS + 20 && hit.path.width / 2 - hit.d >= Math.min(clearance, hit.path.width / 2 - 0.35)) ok = true
    }
    if (!ok) return false
    for (const o of this.obstacles) if (obstacleDistance(o, x, z) < clearance) return false
    return true
  }

  /** 通り道の点（花音の通り道のグラフに足す）: ラボから NAV_RADIUS m までの小道の中心線を 3.5m ごとに */
  navPoints(): XZ[] {
    const out: XZ[] = []
    for (const p of this.paths) {
      let last = -Infinity
      for (let i = 0; i < p.sx.length; i++) {
        if (Math.hypot(p.sx[i], p.sz[i]) > NAV_RADIUS) continue
        const end = i === p.sx.length - 1
        if (p.cum[i] - last >= 3.5 || end || i === 0) {
          out.push([p.sx[i], p.sz[i]])
          last = p.cum[i]
        }
      }
    }
    return out
  }
}

/** 均した地形の高さ（シーンの y）。地形の格子（terrain.ts の terrainHeight）と同じく、名前のある建物の入口の前も均す */
function naturalYGraded(site: SiteModel, x: number, z: number) {
  if (!townData.overview) return -1.3
  return stairGrade(x, -z, namedGrade(x, -z, site.grade(x, -z, naturalHeight(x, -z)))) - LAB
}

/** 見晴らし台の中心から、向き a（0 = 南（+z）、+ は東へ）・距離 d の点 */
export function lookoutPoint(a: number, d: number): [number, number] {
  return [LOOKOUT.center[0] + Math.sin(a) * d, LOOKOUT.center[1] + Math.cos(a) * d]
}

function areaMargin(a: WalkArea, x: number, z: number) {
  if (a.kind === 'disc') return a.radius - Math.hypot(x - a.center[0], z - a.center[1])
  return Math.min(x - a.min[0], a.max[0] - x, z - a.min[1], a.max[1] - z)
}

export function obstacleDistance(o: SiteObstacle, x: number, z: number) {
  if (o.kind === 'circle') return Math.hypot(x - o.center![0], z - o.center![1]) - o.radius!
  const dx = Math.max(o.min![0] - x, 0, x - o.max![0])
  const dz = Math.max(o.min![1] - z, 0, z - o.max![1])
  if (dx === 0 && dz === 0) return -Math.min(x - o.min![0], o.max![0] - x, z - o.min![1], o.max![1] - z)
  return Math.hypot(dx, dz)
}

/** ラボのまわりのセットの形の決まり（1 つだけ） */
export const site = new SiteModel()

/** 地形の格子が使う: 均した標高（平面座標）。ラボから遠い所はそのまま */
export function gradeElevation(x: number, y: number, h: number) {
  if (x < -320 || x > 320 || y < -320 || y > 320) return h
  return site.grade(x, y, h)
}
