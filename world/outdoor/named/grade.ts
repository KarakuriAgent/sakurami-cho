import type { NamedFile } from './namedData'
import type { P2 } from '../town/townData'
import { INTERIOR_ZONES, planOf } from '../../../core/interiors'

/**
 * 名前のある建物の入口の前の地面を均す（地形の格子の高さ。town/terrain.ts の terrainHeight が使う）。
 * 高さ画像は 1m（遠くは 5m）の画素なので、坂の途中の店の扉の前に地面が盛り上がって扉を隠すことがある（星図珈琲の星見石段など）。
 * 入口の前の幅 3m・奥行き 3m を床の 6cm 下までにし、その外は勾配 0.6 で元の地面へ戻す。**下げるだけで上げない**（§7）
 */

interface Pad {
  x: number
  y: number
  /** 外向き（平面の単位ベクトル） */
  nx: number
  ny: number
  z: number
  /** 石段（入口の前の踊り場の先を、段の勾配で下げる）の長さ m（0 なら石段なし） */
  stairs: number
}

/** 石段の踊り場の奥行き・1 段の高さと踏み面（星図珈琲の星見石段。kits/shops.ts の seizu と同じ） */
export const STAIRS = { landing: 1.5, rise: 0.16, run: 0.32, steps: 16, width: 2.8 }

const W = 3.0
const D = 3.0
const SLOPE = 0.6
const RAMP = 4.0
/**
 * 石段の両わきの戻し方（段階 5 の仕上げ。§7 の 112）: 前は入口の前と同じ勾配 0.6・4m で元の地面へ戻していたので、坂の上の側の高さ画像が
 * 石段の横に 2〜3m の土の盛り上がりとして残った。石段のわきは、段の勾配に沿ってゆるく（0.3）広く（9m）戻す
 */
const STAIR_SIDE = { slope: 0.3, ramp: 9.0 }
const CELL = 50
const grid = new Map<string, Pad[]>()

/**
 * 中のある建物の外形（中の床より上に地形が出ないよう、外形の下は床の 0.3m 下まで下げる）。外形の外は、0.5m までを床の 2cm 下より上に出さず、
 * その先は勾配 0.6 で元の地面へ戻す（前は外形の 1m 以内を一律に床の 0.3m 下にしていたので、平らな前の歩道でも壁の足元に深さ 0.3m の溝ができ、
 * 地形の粗い格子で、壁の足元の地面がぎざぎざに見えた。Café Platform 1872 のテラス。§7 の 144）
 */
interface Floor {
  ring: P2[]
  z: number
  x0: number
  x1: number
  y0: number
  y1: number
}
const floors: Floor[] = []

/** 外の段の下の均し（core/interiors.ts の approaches を平面の座標にしたもの） */
interface Approach {
  x: number
  y: number
  /** 外向き（平面の単位ベクトル） */
  nx: number
  ny: number
  half: number
  length: number
  z: number
  slope: number
}
const approaches: Approach[] = []
for (const zone of Object.values(INTERIOR_ZONES)) {
  for (const a of zone.approaches ?? []) {
    const [x, y] = planOf(zone.frame, a.foot[0], a.foot[1])
    const [x1, y1] = planOf(zone.frame, a.foot[0] + a.out[0], a.foot[1] + a.out[1])
    const l = Math.hypot(x1 - x, y1 - y) || 1
    approaches.push({ x, y, nx: (x1 - x) / l, ny: (y1 - y) / l, half: a.width / 2, length: a.length, z: zone.frame.z + a.h - 0.01, slope: a.slope ?? 0.15 })
  }
}
const INTERIOR_IDS = new Set(Object.values(INTERIOR_ZONES).map((z) => z.buildingId))
/** 建物の下の地形を下げる床（ゾーンの groundFloor。null = 下げない） */
const GROUND_FLOOR = new Map(Object.values(INTERIOR_ZONES).filter((z) => z.groundFloor !== undefined).map((z) => [z.buildingId, z.groundFloor ?? null]))

/** 点から多角形の辺までの距離 */
function ringDist(ring: P2[], x: number, y: number) {
  let best = Infinity
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j]
    const dx = ring[i][0] - ax
    const dy = ring[i][1] - ay
    const k = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1e-9)))
    best = Math.min(best, Math.hypot(x - ax - dx * k, y - ay - dy * k))
  }
  return best
}

function inRing(ring: P2[], x: number, y: number) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** 入口の前の均す所を登録する（町を組み立てる前に 1 回） */
export function setNamedPads(named: NamedFile | null) {
  grid.clear()
  floors.length = 0

  if (!named) return
  for (const b of named.buildings) {
    if (!b.drawn) continue
    const gf = GROUND_FLOOR.has(b.id) ? GROUND_FLOOR.get(b.id)! : b.z
    if (INTERIOR_IDS.has(b.id) && gf !== null) {
      const xs = b.ring.map((p) => p[0])
      const ys = b.ring.map((p) => p[1])
      floors.push({ ring: b.ring, z: gf, x0: Math.min(...xs) - 4, x1: Math.max(...xs) + 4, y0: Math.min(...ys) - 4, y1: Math.max(...ys) + 4 })
    }
    // 床を決めた建物（丘ノ上ケーブルの駅）は、データの入口の前を均さない（入口と床の高さは建物の型と中の決まりが決める）
    if (GROUND_FLOOR.has(b.id)) continue
    for (const e of b.entrances) {
      const r = (e.bearing_deg * Math.PI) / 180
      const stairs = b.extra.stairs_id && e.kind === 'main' ? STAIRS.landing + STAIRS.steps * STAIRS.run : 0
      const pad: Pad = { x: e.x, y: e.y, nx: Math.sin(r), ny: Math.cos(r), z: b.z, stairs }
      const reach = Math.max(W / 2, D, stairs) + (stairs > 0 ? STAIR_SIDE.ramp : RAMP)
      for (let gx = Math.floor((e.x - reach) / CELL); gx <= Math.floor((e.x + reach) / CELL); gx++)
        for (let gy = Math.floor((e.y - reach) / CELL); gy <= Math.floor((e.y + reach) / CELL); gy++) {
          const k = `${gx}_${gy}`
          const list = grid.get(k) ?? []
          list.push(pad)
          grid.set(k, list)
        }
    }
  }
}

/** 均したあとの高さ（h = 元の高さ） */
export function namedGrade(x: number, y: number, h: number) {
  // 中のある建物の下は床の 0.3m 下より上に出さない（中の床から地形が見えないように）。外形の外は床の 2cm 下まで、なめらかに戻す
  for (const f of floors) {
    if (x < f.x0 || x > f.x1 || y < f.y0 || y > f.y1) continue
    if (inRing(f.ring, x, y)) h = Math.min(h, f.z - 0.3)
    else h = Math.min(h, f.z - 0.02 + Math.max(0, ringDist(f.ring, x, y) - 0.5) * 0.6)
  }
  for (const a of approaches) {
    const dx = x - a.x
    const dy = y - a.y
    const t = dx * a.nx + dy * a.ny
    const s = Math.abs(dx * a.ny - dy * a.nx)
    // 段の下（t < 0）は段が覆うので、段の下の端の 0.3m 奥まで
    if (t < -0.3 || t > a.length + 6 || s > a.half + 2) continue
    const over = Math.max(0, s - a.half) * 0.6 + Math.max(0, t - a.length) * a.slope
    h = Math.min(h, a.z + over)
  }
  if (!grid.size) return h
  const list = grid.get(`${Math.floor(x / CELL)}_${Math.floor(y / CELL)}`)
  if (!list) return h
  let out = h
  for (const p of list) {
    const dx = x - p.x
    const dy = y - p.y
    const t = dx * p.nx + dy * p.ny
    const s = Math.abs(dx * p.ny - dy * p.nx)
    if (p.stairs > 0) {
      // 石段: 踊り場の先は段の勾配で下がる（段の下の地面）
      if (t < -0.8 || t > p.stairs + STAIR_SIDE.ramp || s > STAIRS.width / 2 + STAIR_SIDE.ramp) continue
      const drop = Math.max(0, Math.min(t, p.stairs) - STAIRS.landing) * (STAIRS.rise / STAIRS.run)
      const side = Math.max(0, s - STAIRS.width / 2 - 0.3)
      const beyond = Math.max(0, t - p.stairs)
      // 段の先（下の路地）はもとの勾配、わきはゆるく戻す。わきの地面は店の床より上に盛り上げない（高さ画像のこぶ）
      out = Math.min(out, p.z - 0.08 - drop + Math.max(side * STAIR_SIDE.slope, beyond * SLOPE), p.z - 0.12)
      continue
    }
    if (t < -0.8 || t > D + RAMP || s > W / 2 + RAMP) continue
    const over = Math.max(0, s - W / 2, t - D)
    out = Math.min(out, p.z - 0.06 + over * SLOPE)
  }
  return out
}
