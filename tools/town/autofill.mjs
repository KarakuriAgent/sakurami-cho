// 街区までの範囲（blocks.geojson の auto_fill: true、約 1,700 街区）に、街区の決まり（用途・階数・建ぺい率・密度・敷地・後退・
// 屋根と壁の色）から名前のない建物を建てる（README の「街区」: auto_fill = true は 3D で中の建物を自動で建てる）。
// 乱数の種は街区の id なので、同じデータなら同じ町になる。
import { FACADE, FLAG, ROOF, USE, facadeOf, orientRect, roofOf, purposeOf, styleOf } from './buildings.mjs'
import { hexIn, insidePolygon, minAreaRect, openRing, pickWeighted, ringDist, rng, seedOf } from './geo.mjs'
import { WATER } from './terrain.mjs'

/** 道の面から離す余白（m）と、ずらしてよい長さ（m）・ずらして確かめ直す回数（§7 の 169） */
const ROAD_MARGIN = 0.3
const ROAD_SHIFT_MAX = 4
const ROAD_TRIES = 2

const PITCH = { [ROOF.gable]: 0.5, [ROOF.hip]: 0.5, [ROOF.irimoya]: 0.55, [ROOF.mansard]: 0.9, [ROOF.shed]: 0.18, [ROOF.sawtooth]: 0.45 }

/** 三角分布（最小・最頻・最大）の整数 */
function triangular(rnd, a, m, b) {
  if (b <= a) return a
  const u = rnd()
  const f = (m - a) / (b - a)
  const x = u < f ? a + Math.sqrt(u * (b - a) * (m - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - m))
  return Math.round(x)
}

/** 色の候補（[{hex, share}]）から選ぶ */
function pickColor(rnd, list, fallback) {
  const entries = (list ?? []).map((c) => [hexIn(c.hex) ?? hexIn(c.name ?? ''), c.share ?? 1]).filter((e) => e[0])
  return entries.length ? pickWeighted(rnd, entries) : fallback
}

/**
 * 街区 1 つに建物を建てる。terrain は地形（標高と水）、clear(x, y, r) は置いてよいか（ラボのまわりなど）、
 * roads は道の面（walkgraph.mjs の RoadStrips。街区の中を通る道・私道・石段に建物をかけない。かかるなら道から離す向きへずらす）、
 * stats は数え（shifted = ずらした・dropped = 道にかかるので建てなかった）。返すのは buildingRecord と同じ形の rect の記録の配列
 */
export function fillBlock(block, terrain, opts) {
  const p = block.properties
  const rnd = rng(seedOf(p.id))
  const rings = block.geometry.coordinates.map(openRing)
  const outer = rings[0]
  const area = p.area_m2 ?? 0
  const want = Math.round((area / 10000) * (p.density_bldg_per_ha ?? 0))
  if (want <= 0 || outer.length < 3) return []
  const use = purposeOf(p.use === 'forest' || p.use === 'farm' ? 'residential' : p.use)
  const lot = Math.max(60, p.lot_size_m2 ?? 200)
  const coverage = Math.min(0.75, Math.max(0.04, p.coverage ?? 0.3))
  const setback = p.setback_m ?? 1.5
  const limited = opts.viewLimited.has(p.id)
  // 敷地の格子（街区の外接長方形の向き）。敷地は間口 : 奥行き = 1 : 1.3
  const mr = minAreaRect(outer)
  const cw = Math.sqrt(lot / 1.3)
  const cd = cw * 1.3
  const c = Math.cos(mr.axis)
  const s = Math.sin(mr.axis)
  const nu = Math.max(1, Math.floor(mr.w / cw))
  const nv = Math.max(1, Math.floor(mr.d / cd))
  const cells = []
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      const u = (i - (nu - 1) / 2) * cw
      const v = (j - (nv - 1) / 2) * cd
      const x = mr.cx + u * c - v * s
      const y = mr.cy + u * s + v * c
      if (!insidePolygon(x, y, rings)) continue
      cells.push([x, y])
    }
  if (!cells.length) return []
  const prob = Math.min(1, want / cells.length)
  const roofTypes = Object.entries(p.roof_types ?? { 切妻: 1 }).map(([k, v]) => [k, v])
  const out = []
  for (const [x0, y0] of cells) {
    if (rnd() > prob) continue
    // 建物の大きさ: 敷地 × 建ぺい率 × ばらつき。間口と奥行きの比は 1〜1.8
    const target = lot * coverage * (0.7 + rnd() * 0.6)
    const aspect = 1 + rnd() * 0.8
    let w = Math.sqrt(target * aspect)
    let d = target / w
    w = Math.min(w, cw * 1.9 - 1.5)
    d = Math.min(d, cd - 1.2)
    if (w < 3.5 || d < 3.5) {
      w = Math.max(w, 4)
      d = Math.max(d, 4)
    }
    let x = x0 + (rnd() - 0.5) * Math.max(0, cw - w) * 0.5
    let y = y0 + (rnd() - 0.5) * Math.max(0, cd - d) * 0.5
    // 置く所を決める。道の面にかかるなら道から離す向きへずらして、もう一度確かめる（ROAD_TRIES 回まで。だめなら建てない）。
    // 乱数（屋根の形）は最初の 1 回だけ引く（道にかからない建物は、前と同じ乱数の並びで同じ町になる）
    let roofName = null
    let placed = null
    let onRoad = false
    for (let attempt = 0; attempt <= ROAD_TRIES; attempt++) {
      // いちばん近い街区の辺（＝道）に正面を向ける。収まるなら建物もその辺にそろえる
      let best = Infinity
      let edge = null
      for (const ring of rings)
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const ax = ring[j][0]
          const ay = ring[j][1]
          const bx = ring[i][0]
          const by = ring[i][1]
          const dx = bx - ax
          const dy = by - ay
          const l2 = dx * dx + dy * dy || 1
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2))
          const qx = ax + dx * t
          const qy = ay + dy * t
          const dd = Math.hypot(qx - x, qy - y)
          if (dd < best) {
            best = dd
            edge = { qx, qy, ang: Math.atan2(dy, dx) }
          }
        }
      if (best < setback + Math.min(w, d) / 2) break
      const frontVec = [edge.qx - x, edge.qy - y]
      const frontBearing = ((Math.atan2(frontVec[0], frontVec[1]) * 180) / Math.PI + 360) % 360
      // 辺にそろえた向きが格子の敷地に収まるか（斜めにすると隣と重なるときは格子の向きのまま）
      const rel = edge.ang - mr.axis
      const fitsRotated = Math.abs(w * Math.cos(rel)) + Math.abs(d * Math.sin(rel)) <= cw * 1.9 - 0.8 && Math.abs(w * Math.sin(rel)) + Math.abs(d * Math.cos(rel)) <= cd - 0.6
      const axis = fitsRotated ? edge.ang : mr.axis
      if (roofName === null) roofName = pickWeighted(rnd, roofTypes)
      const [roof, tsuma] = roofOf(roofName)
      const o = orientRect({ cx: x, cy: y, w, d, axis }, roof, tsuma, frontBearing)
      // 四隅が街区の中・水の上でない・後退距離を守る
      const ux = [Math.cos(o.yaw), Math.sin(o.yaw)]
      const uy = [-Math.sin(o.yaw), Math.cos(o.yaw)]
      let ok = true
      let zMin = Infinity
      let zMax = -Infinity
      const corners = []
      for (const [sx, sy] of [
        [-0.5, -0.5],
        [0.5, -0.5],
        [0.5, 0.5],
        [-0.5, 0.5],
        [0, 0],
      ]) {
        const px = x + ux[0] * sx * o.w + uy[0] * sy * o.d
        const py = y + ux[1] * sx * o.w + uy[1] * sy * o.d
        if (sx !== 0) corners.push([px, py])
        if (sx !== 0 && (!insidePolygon(px, py, rings) || ringDist(px, py, outer) < setback * 0.5)) {
          ok = false
          break
        }
        if (terrain.water(px, py) !== WATER.land) {
          ok = false
          break
        }
        const z = terrain.height(px, py)
        if (z < 0.6) {
          ok = false
          break
        }
        zMin = Math.min(zMin, z)
        zMax = Math.max(zMax, z)
      }
      if (!ok || zMax - zMin > 8 || !opts.clear(x, y, Math.max(o.w, o.d) / 2)) break
      // 道の面（街区の中を通る道・私道・石段。中心線と幅）にかからない（§7 の 169）
      const hit = opts.roads?.hit(corners, ROAD_MARGIN) ?? null
      onRoad = !!hit
      if (!hit) {
        placed = { o, roof, zMin, zMax, shifted: attempt > 0 }
        break
      }
      if (hit.move > ROAD_SHIFT_MAX) break
      x += hit.push[0]
      y += hit.push[1]
    }
    if (!placed) {
      if (onRoad && opts.stats) opts.stats.dropped++
      continue
    }
    if (placed.shifted && opts.stats) opts.stats.shifted++
    const { o, roof, zMin, zMax } = placed
    // 階数と高さ
    let floors
    if (p.profile === 'shiomi.shin') floors = rnd() < 0.22 ? Math.round(20 + rnd() * ((p.floors_max ?? 60) - 20) * rnd()) : triangular(rnd, p.floors_min ?? 8, p.floors_typical ?? 10, 20)
    else floors = triangular(rnd, p.floors_min ?? 1, p.floors_typical ?? 2, p.floors_max ?? 3)
    if (limited) floors = Math.max(1, Math.min(floors, p.floors_min ?? 1))
    let warehouse = false
    if (p.use === 'port' && rnd() < 0.75) warehouse = true
    const fh = warehouse ? 7 + rnd() * 3 : use === USE.office || use === USE.school || use === USE.lab ? 3.8 : use === USE.workshop ? 4.2 : 3.0 + rnd() * 0.25
    if (warehouse) floors = 1
    let eave = floors * fh + 0.4
    const limit = p.height_limit_m
    if (limit && eave > limit - 1) {
      floors = Math.max(1, Math.floor((limit - 1.4) / fh))
      eave = floors * fh + 0.4
    }
    const slope = PITCH[roof] ?? 0
    let rise = roof === ROOF.flat || roof === ROOF.arch ? 0 : Math.min(roof === ROOF.mansard ? 4.5 : 6, (slope * o.d) / 2)
    if (warehouse && roof !== ROOF.flat) rise = Math.min(rise, 0.18 * o.d)
    if (roof === ROOF.sawtooth) rise = 3
    // ラボの窓から町を見る線より上に出ないように（窓の前の斜面の建物。D-085 の注意）。1 階でも出るなら建てない
    const floorZ0 = zMin + (zMax - zMin) * 0.6
    const maxTop = opts.viewCap(x, y)
    while (floors > 1 && floorZ0 + eave + rise > maxTop) {
      floors--
      eave = floors * fh + 0.4
    }
    if (floorZ0 + eave + rise > maxTop) continue
    const wallColor = pickColor(rnd, p.wall_colors, [0xe9, 0xe1, 0xcf])
    const wallName = (p.wall_colors ?? []).find((cc) => hexIn(cc.hex)?.join() === wallColor.join())?.name ?? ''
    const roofColor = pickColor(rnd, p.roof_colors, [0x5a, 0x5a, 0x5c])
    let facade = facadeOf(wallName, null)
    if (warehouse && facade !== FACADE.brick) facade = FACADE.metal
    if (p.profile === 'shiomi.shin' && floors >= 8) facade = rnd() < 0.7 ? FACADE.glass : FACADE.concrete
    const floorZ = floorZ0
    let flags = 0
    if (roofColor.join() === '107,143,78') flags |= FLAG.roofGarden
    if (`${p.greenery ?? ''}`.includes('バルコニー')) flags |= FLAG.flowers
    if (`${p.greenery ?? ''}`.includes('生け垣') || `${p.greenery ?? ''}`.includes('庭')) flags |= FLAG.hedge
    if (p.use === 'commercial' || (p.use_share?.commercial ?? 0) > rnd()) flags |= FLAG.shop
    if (warehouse) flags |= FLAG.warehouse
    if (eave + rise >= 40) flags |= FLAG.tall
    out.push({
      id: `${p.id}.a${out.length + 1}`,
      named: false,
      namedIndex: -1,
      shape: 'rect',
      cx: x,
      cy: y,
      ...o,
      roof,
      facade,
      use: warehouse ? USE.port : use,
      flags,
      floors,
      floorZ,
      base: Math.max(0, floorZ - zMin + 0.3),
      eave,
      ridge: eave + rise,
      wall: wallColor,
      roofColor,
      seed: seedOf(`${p.id}:${out.length}`),
      style: styleOf(p.profile, p.district),
    })
  }
  return out
}

/** views_los.json の auto_blocks（眺めの視線より低く抑える街区）の id の集まり */
export function viewLimitedBlocks(viewsLos) {
  const set = new Set()
  for (const v of viewsLos?.views ?? [])
    for (const t of v.targets ?? [])
      for (const s of t.samples ?? []) for (const b of s.auto_blocks ?? []) set.add(b)
  return set
}
