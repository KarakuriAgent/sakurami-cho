import { townData } from '../outdoor/town/townData'

/**
 * 町の小物（街灯の柱・木の幹）の索引（町の平面座標。タイルの灯りと木から。初めて使うときに作り、タイルが増えたら作り直す）。
 * 旅程の歩く線の小物よけ（character/avatar/travel.ts）と、ホバーの飛ぶ道（character/ride/hoverRide.ts）が使う
 */

let props: Map<number, { x: number; y: number; r: number }[]> | null = null
let propsTiles = 0
const PROP_CELL = 8
function propIndex() {
  const tiles = [...townData.tiles, ...townData.extraTiles.values()]
  if (props && propsTiles === tiles.length) return props
  props = new Map()
  propsTiles = tiles.length
  const add = (x: number, y: number, r: number) => {
    const k = Math.floor(x / PROP_CELL) * 100003 + Math.floor(y / PROP_CELL)
    let l = props!.get(k)
    if (!l) props!.set(k, (l = []))
    l.push({ x, y, r })
  }
  for (const t of tiles) {
    const tp = t.sections.t_pos?.array
    if (tp) for (let i = 0; i < tp.length; i += 4) add(tp[i], tp[i + 1], 0.35)
    const lp = t.sections.l_pos?.array
    const lk = t.sections.l_kind?.array
    if (lp && lk)
      for (let i = 0; i < lp.length / 4; i++) {
        // 街灯（柱のある灯り。灯具が地面から 2.5m より上）
        if (lk[i * 2] !== 1) continue
        const x = lp[i * 4]
        const y = lp[i * 4 + 1]
        if (lp[i * 4 + 2] - townData.heightAt(x, y) > 2.5) add(x, y, 0.2)
      }
  }
  return props
}
/** 点 (x, y) から r m の内の小物（中心と半径） */
export function propsNear(x: number, y: number, r: number) {
  const idx = propIndex()
  const out: { x: number; y: number; r: number }[] = []
  for (let gx = Math.floor((x - r) / PROP_CELL); gx <= Math.floor((x + r) / PROP_CELL); gx++)
    for (let gy = Math.floor((y - r) / PROP_CELL); gy <= Math.floor((y + r) / PROP_CELL); gy++) for (const p of idx.get(gx * 100003 + gy) ?? []) if (Math.hypot(p.x - x, p.y - y) < r + p.r) out.push(p)
  return out
}
