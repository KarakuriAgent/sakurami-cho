// 交通（緑電 4 系統と停留所・ヒノテツ東海岸線の通しの線路・運河バスの航路と乗り場・汐見島連絡船・船だまり・浮遊レーン）と、
// 信号のある交差点を、world が動かす数字にする（形の版 7。読むのは world/outdoor/transit/・core/transit/）
import { openRing, segDist } from './geo.mjs'
import { WATER } from './terrain.mjs'
import { nearestZ } from './infra.mjs'

const r1 = (v) => Math.round(v * 10) / 10
const r2 = (v) => Math.round(v * 100) / 100

/** 線路の構造の番号（world/outdoor/transit/transitData.ts の RAIL_STRUCT と同じ） */
export const RAIL_STRUCT = { at_grade: 0, embankment: 1, concrete_viaduct: 2, stone_arch_viaduct: 3, bridge: 4, cutting: 5, tunnel: 6 }

const lineOf = (g) => (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [])

/** 折れ線の長さの累積 */
function cumulative(pts) {
  const acc = [0]
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  return acc
}

/** 点を折れ線へ投げた位置（線の始まりからの長さ）と、線までの距離 */
function project(pts, acc, x, y) {
  let best = { d: 0, dist: Infinity }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const l2 = dx * dx + dy * dy || 1
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2))
    const dist = Math.hypot(a[0] + dx * t - x, a[1] + dy * t - y)
    if (dist < best.dist) best = { d: acc[i - 1] + Math.sqrt(l2) * t, dist }
  }
  return best
}

/** 水面の標高（海・運河 0、川は中心線の標高、池はデータの水面）。岸の画素（陸）でも川の中心線の近くなら川の標高 */
function waterLevel(terrain, L, x, y) {
  const w = terrain.water(x, y)
  const river = L.water.river_centerline?.[0]
  if (river && w !== WATER.pond) {
    // 川の中心線の近く（川幅の半分 + 12m）は川の水面（運河の画素に分けられた船着き場の前も）
    const c = river.geometry.coordinates
    const widths = Array.isArray(river.properties.width_m) ? river.properties.width_m : null
    let best = Infinity
    let half = 6
    for (let i = 1; i < c.length; i++) {
      const d = segDist(x, y, c[i - 1][0], c[i - 1][1], c[i][0], c[i][1])
      if (d < best) {
        best = d
        half = (widths ? Math.max(widths[i - 1], widths[i]) : (river.properties.width_m ?? 12)) / 2
      }
    }
    if (w === WATER.river || best < half + 12) return nearestZ(c, x, y)
  }
  if (w === WATER.pond) return L.water.pond?.[0]?.properties.water_elev_m ?? 0
  return 0
}

/** 平面の折れ線を step m 以下の区間に */
function densify2(coords, step) {
  const out = [coords[0]]
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]
    const b = coords[i]
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step))
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])
  }
  return out
}

/** 線の z を前後でならす（水面の種類の境の跳びを消す） */
function smoothZ(pts, n = 2) {
  return pts.map((p, i) => {
    let s = 0
    let k = 0
    for (let j = Math.max(0, i - n); j <= Math.min(pts.length - 1, i + n); j++) {
      s += pts[j][2]
      k++
    }
    return [p[0], p[1], r2(s / k)]
  })
}

/** ヒノテツ東海岸線: 浜ノ宮・東都の側のトンネルの口から、桜見駅を通って、鐘ヶ丘・入江の側のトンネルの口までの通しの線（3D と構造） */
function railPath(L) {
  const feats = L.railway.railway ?? []
  const part = (prefix) =>
    feats
      .filter((f) => f.properties.id.startsWith(prefix))
      .sort((a, b) => (a.properties.chainage_m?.[0] ?? 0) - (b.properties.chainage_m?.[0] ?? 0))
      .map((f) => ({ pts: f.geometry.coordinates, s: RAIL_STRUCT[f.properties.structure] ?? 0, chainage: f.properties.chainage_m ?? [0, 0] }))
  const ne = part('rail.hinotetsu.ne.')
  const east = part('rail.hinotetsu.east.')
  if (!ne.length || !east.length) return null
  const out = []
  const push = (p, s) => {
    const last = out[out.length - 1]
    if (last && Math.hypot(last[0] - p[0], last[1] - p[1]) < 0.05) {
      last[3] = s
      return
    }
    out.push([r1(p[0]), r1(p[1]), r2(p[2]), s])
  }
  // 浜ノ宮の側は、遠い方から（線の向きを逆に）。点の構造は「その点から次の点まで」の構造
  for (const seg of [...ne].reverse()) {
    const pts = [...seg.pts].reverse()
    for (const p of pts) push(p, seg.s)
  }
  const platNe = out.length - 1
  for (const seg of east) seg.pts.forEach((p) => push(p, seg.s))
  const acc = cumulative(out)
  // 駅（桜見はホームの中ほど、鐘ヶ丘は駅の点を投げた所）
  const platform = L.railway.platform?.[0]
  const stations = []
  const dNe = acc[platNe]
  const platLen = platform?.properties.length_m ?? 260
  stations.push({ id: 'station.sakurami', name: '桜見', d: r1(dNe + platLen / 2), platform: [r1(dNe), r1(dNe + platLen)], local: true, rapid: true })
  const kane = (L.railway.station ?? []).find((f) => f.properties.id === 'station.kanegaoka')
  if (kane) {
    const pr = project(out, acc, kane.geometry.coordinates[0], kane.geometry.coordinates[1])
    stations.push({ id: 'station.kanegaoka', name: '鐘ヶ丘', d: r1(pr.d), platform: [r1(pr.d - 100), r1(pr.d + 100)], local: true, rapid: false })
  }
  return { pts: out, length: r1(acc[acc.length - 1]), stations }
}

/** 緑電の系統と停留所 */
function trams(L) {
  const lines = (L.transit.tram_line ?? []).map((f) => {
    const p = f.properties
    const pts = f.geometry.coordinates.map((c) => [r1(c[0]), r1(c[1]), r2(c[2] ?? 0)])
    return {
      id: p.id,
      no: p.line_no,
      name: p.name,
      color: p.color,
      loop: !!p.loop,
      minutes: p.minutes_text,
      length: r1(cumulative(pts).at(-1)),
      pts,
      stops: p.stops.map((name, i) => ({ name, d: r1(p.stop_distance_m[i]), min: p.stop_minutes_text[i] })),
    }
  })
  const stops = (L.transit.tram_stop ?? []).map((f) => ({ id: f.properties.id, name: f.properties.name, lines: f.properties.lines, x: r1(f.geometry.coordinates[0]), y: r1(f.geometry.coordinates[1]), z: r2(f.geometry.coordinates[2] ?? 0) }))
  return { lines, stops }
}

/** 運河バスの航路・汐見島連絡船の航路（水面の標高つき）と乗り場 */
function boats(terrain, L) {
  const piers = new Map()
  for (const f of [...(L.transit.waterbus_pier ?? []), ...(L.transit.ferry_pier ?? [])]) piers.set(f.properties.landing_id ?? f.properties.pier_id, { id: f.properties.id, name: f.properties.name, x: f.geometry.coordinates[0], y: f.geometry.coordinates[1] })
  const pierById = new Map([...(L.transit.waterbus_pier ?? []), ...(L.transit.ferry_pier ?? [])].map((f) => [f.properties.id, { id: f.properties.id, name: f.properties.name, x: f.geometry.coordinates[0], y: f.geometry.coordinates[1] }]))
  // 10m ごとの点にしてから水面の標高を入れる（川を上る航路は、川の中心線の標高に沿う）
  const withLevel = (coords) => smoothZ(densify2(coords, 10).map((c) => [r1(c[0]), r1(c[1]), r2(waterLevel(terrain, L, c[0], c[1]))]))
  const stopsOf = (pts, ids) => {
    const acc = cumulative(pts)
    const list = []
    let from = 0
    ids.forEach((sid, i) => {
      const pier = piers.get(sid) ?? pierById.get(sid)
      if (!pier) return
      // 線の始まり・終わりの乗り場は端に（輪の航路の最後は線の終わり）
      if (i === ids.length - 1 && ids[0] === sid) return list.push({ id: pier.id, name: pier.name, d: r1(acc.at(-1)) })
      // 前の乗り場より先の所に投げる（輪の航路で、同じ所を 2 回通る線の取り違えを防ぐ）
      let best = { d: 0, dist: Infinity }
      for (let k = 1; k < pts.length; k++) {
        if (acc[k] < from) continue
        const pr = project([pts[k - 1], pts[k]], [acc[k - 1], acc[k]], pier.x, pier.y)
        if (pr.dist < best.dist - 0.5) best = pr
      }
      from = best.d
      list.push({ id: pier.id, name: pier.name, d: r1(best.d) })
    })
    return list
  }
  const routes = (L.transit.waterbus_route ?? []).map((f) => {
    const p = f.properties
    const pts = withLevel(f.geometry.coordinates)
    const loop = p.stops[0] === p.stops[p.stops.length - 1]
    return { id: p.id, route: p.route, name: p.name, loop, minutes: p.minutes_text, speed: p.speed_kmh, color: p.color, length: r1(cumulative(pts).at(-1)), pts, stops: stopsOf(pts, p.stops) }
  })
  const fr = L.transit.ferry_route?.[0]
  const ferry = fr
    ? (() => {
        const pts = withLevel(fr.geometry.coordinates)
        return { id: fr.properties.id, name: fr.properties.name, minutes: fr.properties.minutes_text, ships: fr.properties.ships, length: r1(cumulative(pts).at(-1)), pts, stops: stopsOf(pts, fr.properties.stops) }
      })()
    : null
  const basins = (L.water.basin ?? []).map((f) => ({ id: f.properties.id, name: f.properties.name, use: f.properties.use ?? '', ring: openRing(f.geometry.coordinates[0]).map((c) => [r1(c[0]), r1(c[1])]) }))
  // 運河の石段の船着き場（小舟をつなぐ）
  const landings = (L.water.landing ?? []).map((f) => ({ id: f.properties.id, x: r1(f.geometry.coordinates[0]), y: r1(f.geometry.coordinates[1]), bearing: f.properties.bearing_to_water_deg ?? 0, bus: !!f.properties.waterbus_stop }))
  return { routes, ferry, basins, landings }
}

/** 浮遊レーン（標高つきの線） */
function lanes(L) {
  return (L.transit.float_lane ?? []).flatMap((f) =>
    lineOf(f.geometry).map((ln, i) => ({ id: `${f.properties.id}${i ? `.${i}` : ''}`, name: f.properties.name, color: f.properties.color, alt: f.properties.alt_m, spacing: f.properties.lane_light_pole_spacing_m ?? 40, pts: ln.map((c) => [r1(c[0]), r1(c[1]), r2(c[2] ?? 0)]) })),
  )
}

/**
 * 信号のある交差点: 幹線・補助幹線（trunk・arterial）と、幹線・補助幹線・生活道路（local）が交わる所で、3 方向以上に道が出る所。
 * 交差点の中心・出ていく道の向き（北から時計回りではなく、平面の atan2(y, x)）・道の幅
 */
function signals(L, terrain) {
  const roads = (L.roads.road ?? []).filter((f) => ['trunk', 'arterial', 'local'].includes(f.properties.class) && !f.properties.underground)
  const segs = []
  roads.forEach((f, ri) => {
    for (const ln of lineOf(f.geometry)) for (let i = 1; i < ln.length; i++) segs.push({ ri, a: ln[i - 1], b: ln[i], major: f.properties.class !== 'local', w: f.properties.width_m ?? 8 })
  })
  const cell = 60
  const grid = new Map()
  const key = (cx, cy) => `${cx},${cy}`
  segs.forEach((s, i) => {
    const x0 = Math.floor(Math.min(s.a[0], s.b[0]) / cell)
    const x1 = Math.floor(Math.max(s.a[0], s.b[0]) / cell)
    const y0 = Math.floor(Math.min(s.a[1], s.b[1]) / cell)
    const y1 = Math.floor(Math.max(s.a[1], s.b[1]) / cell)
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) (grid.get(key(cx, cy)) ?? grid.set(key(cx, cy), []).get(key(cx, cy))).push(i)
  })
  // 道の端点が、別の道の線の上（4m 以内）にある所 = 交差点の候補
  const cands = []
  roads.forEach((f, ri) => {
    for (const ln of lineOf(f.geometry)) {
      for (const p of [ln[0], ln[ln.length - 1]]) {
        const near = grid.get(key(Math.floor(p[0] / cell), Math.floor(p[1] / cell))) ?? []
        for (const si of near) {
          const s = segs[si]
          if (s.ri === ri) continue
          if (segDist(p[0], p[1], s.a[0], s.a[1], s.b[0], s.b[1]) < 4) {
            cands.push({ x: p[0], y: p[1], major: s.major || f.properties.class !== 'local' })
            break
          }
        }
      }
    }
  })
  // 近い候補（14m 以内）をまとめる
  const clusters = []
  for (const c of cands) {
    const hit = clusters.find((k) => Math.hypot(k.x - c.x, k.y - c.y) < 14)
    if (hit) {
      hit.major ||= c.major
      continue
    }
    clusters.push({ ...c })
  }
  const out = []
  for (const k of clusters) {
    if (!k.major) continue
    // 出ていく道の向き（交差点の中心から 12m の所の道の向き）
    const dirs = []
    const near = new Set()
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const si of grid.get(key(Math.floor(k.x / cell) + dx, Math.floor(k.y / cell) + dy)) ?? []) near.add(si)
    for (const si of near) {
      const s = segs[si]
      for (const [p, q] of [
        [s.a, s.b],
        [s.b, s.a],
      ]) {
        // p が交差点の近く、q が外へ出る向き
        if (Math.hypot(p[0] - k.x, p[1] - k.y) > 9) continue
        if (Math.hypot(q[0] - k.x, q[1] - k.y) < 6) continue
        const ang = Math.atan2(q[1] - k.y, q[0] - k.x)
        if (dirs.some((d) => Math.abs(Math.atan2(Math.sin(d.a - ang), Math.cos(d.a - ang))) < 0.5)) continue
        dirs.push({ a: r2(ang), w: s.w, major: s.major })
      }
      // 線の途中を通り抜ける道（交差点が線分の中ほど）
      if (segDist(k.x, k.y, s.a[0], s.a[1], s.b[0], s.b[1]) < 4 && Math.hypot(s.a[0] - k.x, s.a[1] - k.y) > 9 && Math.hypot(s.b[0] - k.x, s.b[1] - k.y) > 9) {
        for (const q of [s.a, s.b]) {
          const ang = Math.atan2(q[1] - k.y, q[0] - k.x)
          if (dirs.some((d) => Math.abs(Math.atan2(Math.sin(d.a - ang), Math.cos(d.a - ang))) < 0.5)) continue
          dirs.push({ a: r2(ang), w: s.w, major: s.major })
        }
      }
    }
    if (dirs.length < 3) continue
    if (terrain.water(k.x, k.y) !== WATER.land) continue
    out.push({ x: r1(k.x), y: r1(k.y), z: r2(terrain.height(k.x, k.y)), dirs })
  }
  return out
}

export function buildTransit(terrain, L) {
  const t0 = trams(L)
  const b = boats(terrain, L)
  return { trams: t0.lines, tramStops: t0.stops, rail: railPath(L), waterbus: b.routes, ferry: b.ferry, basins: b.basins, landings: b.landings, lanes: lanes(L), signals: signals(L, terrain) }
}

