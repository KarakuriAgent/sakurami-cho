import { SITE } from '../../core/town'
import { townData } from '../outdoor/town/townData'
import { townWalk } from './townWalk'

/**
 * 浮遊レーンの通り道（docs/design/town.md §7 の 214）。町の地図データの浮遊レーンの多くは道の上の街路樹の並び・森の小径の上を、
 * 地上 3m ほどで通り、木の葉（地上 2.5〜3.5m から上）の中を通っていた。町はレーンの通り道の枝を払ってある（剪定）とし、
 * レーンの真ん中の線から左右 HALF_W m・高さはレーンの線の 1.2m 下から 3.3m 上（ホバーの一人乗りの花音の頭と並んで飛ぶ KB-001 まで）の
 * 箱の中の葉を、木を描くとき（town/trees.ts。葉を通り道の壁へ寄せる）と当たりの形（townSolids の葉）から除く。幹は残す（ホバーがよける）。
 *
 * 座標: 平面（x = 東、y = 北、z = 標高）。near は、平面の点のまわり reach m の内でいちばん近いレーンの線の区間
 */

export const LANE_CORRIDOR_HALF_W = 2.1
/** レーンの線からの高さの範囲（下・上。m） */
const BELOW = 1.2
const ABOVE = 3.3
const CELL = 16
const STEP = 4

interface Seg {
  ax: number
  ay: number
  bx: number
  by: number
  /** 区間の両端の通り道の下と上の標高 */
  z0a: number
  z1a: number
  z0b: number
  z1b: number
}

export interface CorridorHit {
  /** 通り道の真ん中の線への法線（平面の単位ベクトル。点の側を向く）と、点から線までの距離（m） */
  nx: number
  ny: number
  dist: number
  /** その所の通り道の下と上の標高 */
  z0: number
  z1: number
}

class LaneCorridor {
  private segs: Seg[] = []
  private grid = new Map<number, number[]>()
  private built = -1

  /** 町の道の版（townWalk.version）が変わったら作り直す */
  private ensure() {
    const lanes = townData.infra?.transit?.lanes
    if (!lanes || !townWalk.ready) return false
    if (this.built === townWalk.version) return true
    this.segs = []
    this.grid.clear()
    for (const l of lanes) {
      // 4m ごとに区切る（地面からの高さで通り道の下を決める。ホバーは地面から 2.6m より下を飛ばない）
      const pts: [number, number, number, number][] = []
      for (let i = 1; i < l.pts.length; i++) {
        const a = l.pts[i - 1]
        const b = l.pts[i]
        const len = Math.hypot(b[0] - a[0], b[1] - a[1])
        const n = Math.max(1, Math.ceil(len / STEP))
        for (let k = i === 1 ? 0 : 1; k <= n; k++) {
          const t = k / n
          const x = a[0] + (b[0] - a[0]) * t
          const y = a[1] + (b[1] - a[1]) * t
          const z = a[2] + (b[2] - a[2]) * t
          const g = townWalk.groundY(x, -y, z - SITE.labFloorElevation, false) + SITE.labFloorElevation
          const lo = Math.min(z, g + 2.6) - BELOW
          const hi = Math.max(z, g + 2.6) + ABOVE
          pts.push([x, y, lo, hi])
        }
      }
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]
        const b = pts[i]
        const s: Seg = { ax: a[0], ay: a[1], bx: b[0], by: b[1], z0a: a[2], z1a: a[3], z0b: b[2], z1b: b[3] }
        const id = this.segs.push(s) - 1
        const pad = 12
        for (let gx = Math.floor((Math.min(s.ax, s.bx) - pad) / CELL); gx <= Math.floor((Math.max(s.ax, s.bx) + pad) / CELL); gx++)
          for (let gy = Math.floor((Math.min(s.ay, s.by) - pad) / CELL); gy <= Math.floor((Math.max(s.ay, s.by) + pad) / CELL); gy++) {
            const key = gx * 100003 + gy
            let list = this.grid.get(key)
            if (!list) this.grid.set(key, (list = []))
            list.push(id)
          }
      }
    }
    this.built = townWalk.version
    return true
  }

  /** 平面の点 (x, y) からいちばん近いレーンの通り道（reach m より遠ければ null。reach は 12m まで） */
  near(x: number, y: number, reach: number, out: CorridorHit): CorridorHit | null {
    if (!this.ensure()) return null
    const list = this.grid.get(Math.floor(x / CELL) * 100003 + Math.floor(y / CELL))
    if (!list) return null
    let best = reach
    let hit = false
    for (const i of list) {
      const s = this.segs[i]
      const dx = s.bx - s.ax
      const dy = s.by - s.ay
      const l2 = dx * dx + dy * dy || 1e-9
      const t = Math.min(1, Math.max(0, ((x - s.ax) * dx + (y - s.ay) * dy) / l2))
      const px = s.ax + dx * t
      const py = s.ay + dy * t
      const d = Math.hypot(x - px, y - py)
      if (d >= best) continue
      best = d
      hit = true
      // 法線は区間の向きに垂直（線の端の外の点でも、線に垂直な面で切る）
      const l = Math.sqrt(l2)
      let nx = -dy / l
      let ny = dx / l
      const side = (x - px) * nx + (y - py) * ny
      if (side < 0) {
        nx = -nx
        ny = -ny
      }
      out.nx = nx
      out.ny = ny
      out.dist = Math.abs(side)
      out.z0 = s.z0a + (s.z0b - s.z0a) * t
      out.z1 = s.z1a + (s.z1b - s.z1a) * t
    }
    return hit ? out : null
  }
}

export const laneCorridor = new LaneCorridor()
