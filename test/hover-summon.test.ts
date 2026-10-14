/**
 * ホバー（character/ride/hoverRide.ts。#9 で乗り場を無くし、どこからでも呼べる形にした）:
 *
 * - 呼ぶ（summonHover）: 町のどこ（道・広場・坂・石段の踊り場・橋・ラボの前・建物の前）で呼んでも、近くの歩ける所（道・広場の上。建物・木・街灯・
 *   緑電の線路にかからない）に来る。乗り降りする横の所は呼んだ人の側。ラボ・中のある建物の中で呼ぶと、そのゾーンの外の出入口の前の近くに来る。
 *   100m の内なら飛んで来て（ファンを回してから）、横に下りて待つ。遠い・まだ一度も呼んでいないときは、すぐ横に現れる
 * - 飛ぶ道（planHoverFlight）: 町の道のグラフの上だけを、地面から 0.6m（ならして 0.45〜0.95m）の高さで、坂・石段・橋は地面に沿って飛ぶ。
 *   建物・木・石段のわきの擁壁・街灯の柱にかからず、道・広場の外へ出ない。いちばん速いのは 12 m/s
 * - 旅程の via=hover（そのまま・カット・早送り・一度に）: 区間の始めで呼んで乗り、行き先の近くまで飛んで下りて降り、そこから歩いて着く。
 *   どの時間の扱いでも同じ所に着き、ホバーは下りた所に置いてある（次に呼ぶとそこから来る）
 * - 呼べないとき: 町の道のデータが無い・乗り物に乗っている
 *
 * 町の地図データ（道・地形・タイルの建物と木・中のある建物の決まり）と交通の運行（緑電の時刻）を描かずに作り、町の毎コマと同じ順で 1/30 秒ずつ進める。
 * ほかのテストの表が混ざらないよう、まっさらな bun のプロセスで確かめる
 */
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

const PKG = join(import.meta.dir, '..')

const PROBE = `
const P = ${JSON.stringify(PKG)}
const noop = () => undefined
const ctx2d = new Proxy({}, {
  get: (t, k) => (k in t ? t[k] : k === 'measureText' ? (s) => ({ width: String(s).length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }) : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: noop }) : k === 'getImageData' ? (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : noop),
  set: (t, k, v) => ((t[k] = v), true),
})
globalThis.document = { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx2d }) }
console.info = noop
console.warn = noop
const fs = await import('node:fs')
const { configureTown } = await import(P + '/world/townHost.ts')
configureTown({ allTiles: true })
const { townWalk } = await import(P + '/world/walk/townWalk.ts')
const { townData, HeightLayer } = await import(P + '/world/outdoor/town/townData.ts')
const { parseContainer, gunzip } = await import(P + '/world/outdoor/town/container.ts')
const { site } = await import(P + '/world/outdoor/site/siteModel.ts')
const { buildKit } = await import(P + '/world/outdoor/named/kits/index.ts')
const { namedInteriorParts } = await import(P + '/world/outdoor/named/interiorParts.ts')
const { interiors } = await import(P + '/world/outdoor/interior/interiors.ts')
const { INTERIOR_ZONES, INTERIOR_ZONE_IDS } = await import(P + '/core/interiors.ts')
const { setupTramNet } = await import(P + '/world/outdoor/transit/trams.ts')
const { createTransit } = await import(P + '/world/outdoor/transit/transit.ts')
const { transitClock } = await import(P + '/world/outdoor/transit/clock.ts')
const { clockWarp, townWarp } = await import(P + '/core/clock.ts')
const { createCharacter } = await import(P + '/character/avatar/createCharacter.ts')
const { updateLocomotion, placeAt } = await import(P + '/character/avatar/locomotion.ts')
const { placeAtPoint } = await import(P + '/character/avatar/teleport.ts')
const { driveRides } = await import(P + '/character/ride/drive.ts')
const { updateRiders } = await import(P + '/character/ride/riders.ts')
const { setWarpPermit } = await import(P + '/character/ride/warp.ts')
const { hoverHome } = await import(P + '/world/outdoor/transit/hoverCraft.ts')
const HR = await import(P + '/character/ride/hoverRide.ts')
const TR = await import(P + '/character/avatar/travel.ts')
const { TRAVEL_PLACES, ZONE_PORTALS } = await import(P + '/core/travel.ts')
const { TOWN_PLACES } = await import(P + '/core/places.ts')
const read = (f) => JSON.parse(fs.readFileSync(P + '/assets/town/' + f, 'utf8'))
const bin = async (f) => {
  const b = fs.readFileSync(P + '/assets/town/' + f)
  return parseContainer(await gunzip(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)))
}
const out = {}
const ch = createCharacter({ id: 'probe', spawn: 'front', seed: null })
// 町の道のデータを読む前は呼べない
out.beforeData = HR.summonHover(ch)

// 町の地図データ（道・地形・タイルの建物と木）と、組み立ての順（ラボのまわりのセット → 外観の型 → 中の決まり → 緑電のホーム → 交通の運行）
const infra = read('infra.json')
const named = read('named.json')
const manifest = read('manifest.json')
townWalk.init(read('walk.json'), infra)
townData.center = new HeightLayer(await bin('terrain/center.bin'))
townData.overview = new HeightLayer(await bin('terrain/overview.bin'))
townData.infra = infra
townData.manifest = manifest
for (const e of manifest.tiles.list) townData.tiles.push(await bin(e.file))
site.build()
const buildings = new Set(INTERIOR_ZONE_IDS.map((id) => INTERIOR_ZONES[id].buildingId))
for (const rec of named.buildings) {
  if (!buildings.has(rec.id)) continue
  const { kit } = buildKit(rec, { infra, heightAt: (x, y) => townData.heightAt(x, y) })
  if (kit.interior) namedInteriorParts.kits.set(rec.id, kit)
}
interiors.init(named, (x, z, step) => townWalk.groundY(x, z, 0, step))
setupTramNet(infra.transit)
const transit = createTransit(infra, [], () => false, 400)

ch.drivers.motion = driveRides
ch.drivers.travel = TR.driveTravel
setWarpPermit((c) => c === ch)
const D = HR.hoverRideDebug(ch)
const DT = 1 / 30
let t = 0
let elapsed = 0
const frame = () => {
  t += DT
  townWarp.apply(t)
  elapsed += DT
  const sec = 10 * 3600 + elapsed + clockWarp.offsetSec
  transitClock.sec = sec
  transitClock.serviceSec = sec
  transit.update(null, DT, 1, false)
  updateRiders([ch], t, DT)
  updateLocomotion(ch, t, DT)
}
const r3 = (v) => Math.round(v * 1000) / 1000
const onWay = (x, z, m = 0) => townWalk.onWalkway(x, z, m)
/** 飛ぶ道の確かめ: 水平に飛ぶ所の建物・木・街灯・道の外・地面からの高さ（ならした高さと、地面 + 0.6m との差） */
const flightCheck = (f) => {
  let follow = 0
  for (let i = 2; i < f.pts.length - 2; i++) {
    const q = f.pts[i]
    const run = Math.min(q.s - f.pts[1].s, f.pts[f.pts.length - 2].s - q.s)
    if (run > 3) follow = Math.max(follow, Math.abs(q.p.y - q.g - 0.6))
  }
  const c = f.clearance
  return { length: Math.round(f.length), total: r3(f.total), blocked: c.blocked, offWay: c.offWay, minAbove: r3(c.minAbove), maxAbove: r3(c.maxAbove), follow: r3(follow), vmax: r3(Math.max(...f.pts.map((q) => q.v))) }
}

// 1. 呼ぶ所: 道・広場・坂・石段の踊り場・橋・ラボの前・建物の前（どれもまず遠くへ置いたホバーが、すぐ横に現れる）
const nav = townWalk.nav
const edgeMid = (pred) => {
  for (let e = 0; e < nav.data.edges.length; e++) if (pred(e)) {
    const p = nav.pointOnEdge(e, nav.edgeLength(e) / 2)
    return [p[0], -p[1]]
  }
  return null
}
const bridge = edgeMid((e) => nav.data.edges[e].k === 2 && nav.edgeLength(e) > 20)
const slope = edgeMid((e) => nav.data.names[nav.data.edges[e].n] === '楓坂（坂道）' && nav.edgeLength(e) > 20)
const SPOTS = [
  ['road', { at: TRAVEL_PLACES.hiraki.at }],
  ['plaza', { place: 'cafe-front' }],
  ['slope', { scene: slope }],
  ['stairs-landing', { at: ZONE_PORTALS.thompson[0].town }],
  ['bridge', { scene: bridge }],
  ['lab-front', { place: 'front' }],
  ['thompson-front', { place: 'thompson-front' }],
  ['seizu-front', { place: 'seizu-front' }],
  ['dome-gate', { place: 'dome-gate' }],
  ['soranowa-front', { place: 'soranowa-front' }],
  ['cable-fumoto-front', { place: 'cable-fumoto-front' }],
  ['kitaguchi', { at: TRAVEL_PLACES.kitaguchi.at }],
]
const put = (w) => {
  if (w.place) placeAt(ch, w.place, false)
  else if (w.scene) placeAtPoint(ch, w.scene[0], w.scene[1], 0)
  else placeAtPoint(ch, w.at[0], -w.at[1], 0)
  for (let i = 0; i < 3; i++) frame()
}
out.spots = []
for (const [id, w] of SPOTS) {
  put(w)
  // ホバーは遠く（南西の端）に置いてあることにする
  HR.parkHoverAt({ x: -5000, y: 0, z: 5000, heading: 0, side: 1 })
  const m = ch.motion
  const r = HR.summonHover(ch)
  const st = HR.hoverStatus()
  const side = hoverHome.side
  // 乗り降りする横の所（局所の x = side × 0.78）
  const c = Math.cos(hoverHome.heading)
  const s = Math.sin(hoverHome.heading)
  const sx = hoverHome.x + side * 0.78 * c + 0.12 * s
  const sz = hoverHome.z - side * 0.78 * s + 0.12 * c
  out.spots.push({ id, zone: m.zone, error: r, phase: st.phase, d: r3(Math.hypot(st.x - m.position.x, st.z - m.position.z)), dy: r3(hoverHome.y - m.position.y), onWay: onWay(st.x, st.z, 0.55), blocked: D.hoverBlocked(hoverHome.x, hoverHome.y, hoverHome.z) || D.propBlocked(hoverHome.x, hoverHome.z, 0.45), tram: D.nearTram(hoverHome.x, hoverHome.z), sideNear: r3(Math.hypot(sx - m.position.x, sz - m.position.z)) })
}

// 2. ラボ・中のある建物の中で呼ぶ: 外の出入口の前の近く
out.inside = []
for (const [place, zone] of [['desk', 'lab'], ['holotable', 'lab'], ['thompson-desk', 'thompson'], ['cafe-counter', 'cafe'], ['seizu-counter', 'seizu']]) {
  placeAt(ch, place, false)
  for (let i = 0; i < 3; i++) frame()
  HR.parkHoverAt({ x: -5000, y: 0, z: 5000, heading: 0, side: 1 })
  const r = HR.summonHover(ch)
  const st = HR.hoverStatus()
  const portal = ZONE_PORTALS[zone][0].town
  out.inside.push({ place, zone: ch.motion.zone, error: r, phase: st.phase, portalD: r3(Math.hypot(st.x - portal[0], st.z + portal[1])), onWay: onWay(st.x, st.z, 0.55) })
}

// 3. 近くで呼ぶ: 飛んで来る（ファンを回してから出る）。着いたら横で待ち、飛ぶ道は建物・木などにかからない
/** 町の点 a（平面座標）から、点 toward へ向かう町の道を dist m 進んだ所（シーンの x, z） */
const along = (a, toward, dist) => {
  const pl = nav.polyline(townWalk.route(a, toward, { cable: false, underground: false }))
  const q = pl.find((p) => p.s >= dist) ?? pl[pl.length - 1]
  return [q.x, -q.y]
}
out.come = []
for (const [a, b] of [
  [{ at: ZONE_PORTALS.seizu[0].town }, { scene: along(ZONE_PORTALS.seizu[0].town, TRAVEL_PLACES.kitaguchi.at, 40) }],
  [{ place: 'front' }, { scene: along(ZONE_PORTALS.lab[0].town, ZONE_PORTALS.thompson[0].town, 60) }],
  [{ at: ZONE_PORTALS.dome[1].town }, { scene: along(ZONE_PORTALS.dome[1].town, TRAVEL_PLACES.onodera.at, 60) }],
]) {
  put(a)
  HR.summonHover(ch)
  put(b)
  const from = { x: hoverHome.x, z: hoverHome.z }
  const r = HR.summonHover(ch)
  const st0 = HR.hoverStatus()
  const f = D.summon.flight
  let n = 0
  let lifted = 0
  while (HR.hoverStatus().phase === 'coming' && n++ < 30 * 300) {
    frame()
    lifted = Math.max(lifted, D.hoverCraft.power)
  }
  const st = HR.hoverStatus()
  out.come.push({ error: r, phase0: st0.phase, eta: r3(st0.arriveInSec ?? -1), sec: r3(n / 30), from: r3(Math.hypot(from.x - ch.motion.position.x, from.z - ch.motion.position.z)), phase: st.phase, d: r3(Math.hypot(st.x - ch.motion.position.x, st.z - ch.motion.position.z)), power: r3(lifted), flight: f ? flightCheck(f) : null })
}

// 4. 飛ぶ道（出入口・町の行き先の近くの間）
const ends = [...Object.entries(TRAVEL_PLACES).map(([id, p]) => [id, p.at]), ...Object.entries(ZONE_PORTALS).filter(([z]) => z !== 'dome').map(([z, l]) => [z, l[0].town])]
const parks = ends.map(([id, at]) => [id, HR.hoverSpotNear(at[0], -at[1], townWalk.groundY(at[0], -at[1]))])
out.flights = []
for (let i = 0; i < parks.length; i++)
  for (let j = 0; j < parks.length; j++) {
    if (i === j || (i + j) % 3 !== 0) continue
    const f = HR.planHoverFlight(parks[i][1], parks[j][1], { avoid: true })
    out.flights.push({ from: parks[i][0], to: parks[j][0], ...(typeof f === 'string' ? { error: f } : flightCheck(f)) })
  }

// 5. 旅程の via=hover（そのまま・カット・早送り・一度に）
const ORIGINS = { lab: { place: 'front' }, kitaguchi: { at: TRAVEL_PLACES.kitaguchi.at }, cafe: { place: 'cafe-counter' }, summit: { at: ZONE_PORTALS['cable-summit'][0].town } }
const go = (o, to, time, via = 'hover') => {
  TR.cancelTravel(ch)
  for (let i = 0; i < 30 * 60 && (ch.ride.phase !== 'none' || TR.traveling(ch)); i++) frame()
  townWarp.cancel(ch)
  put(ORIGINS[o])
  clockWarp.offsetSec = 0
  elapsed = 0
  const req = { to, route: 'auto', time: time === 'none' ? 'cut' : time, cut: time === 'none' ? 'none' : 'leg', showSec: 5, fastSec: 30, fastSpeed: null, activity: false, via }
  const plan = TR.startTravel(ch, req)
  if (TR.isTravelProblem(plan)) return { o, to, time, problem: plan.code }
  const seg = plan.segs.find((s) => s.kind === 'ride' && s.vehicle === 'hover')
  const serials = { ...ch.ride.serials }
  let n = 0
  let flight = null
  let steps = new Set()
  while ((TR.traveling(ch) || ch.ride.phase !== 'none') && n++ < 30 * 3600) {
    frame()
    const c = ch.rides.hover
    if (c.step !== 'idle') steps.add(c.step)
    if (c.step === 'fly' && c.flight) flight = c.flight
  }
  for (let i = 0; i < 150; i++) frame()
  const m = ch.motion
  const row = { o, to, time, segs: plan.segs.map((s) => (s.kind === 'ride' ? s.vehicle : s.kind)).join(' '), error: ch.travel.error, x: r3(m.position.x), z: r3(m.position.z), zone: m.zone, stopId: m.stopId, steps: [...steps].join(' '), board: ch.ride.serials.board - serials.board, alight: ch.ride.serials.alight - serials.alight, home: seg?.park ? r3(Math.hypot(hoverHome.x - seg.park.x, hoverHome.z - seg.park.z)) : null, flight: flight ? flightCheck(flight) : null }
  if (TRAVEL_PLACES[to]) row.d = r3(Math.hypot(m.position.x - TRAVEL_PLACES[to].at[0], -m.position.z - TRAVEL_PLACES[to].at[1]))
  return row
}
out.travel = []
for (const [o, to] of [['lab', 'kitaguchi'], ['kitaguchi', 'hiraki'], ['cafe', 'thompson-desk'], ['summit', 'onodera'], ['lab', 'soranowa-front']]) for (const time of ['real', 'cut', 'fast', 'none']) {
  if (time === 'real' && !(o === 'kitaguchi' && to === 'hiraki')) continue
  out.travel.push(go(o, to, time))
}
// 比べる: 歩いて行ったとき（一度に着く）の着く所
out.walked = {}
for (const [o, to] of [['lab', 'kitaguchi'], ['kitaguchi', 'hiraki'], ['cafe', 'thompson-desk'], ['summit', 'onodera'], ['lab', 'soranowa-front']]) {
  const w = go(o, to, 'none', 'walk')
  out.walked[o + '>' + to] = [w.x, w.z]
}
// 乗っている間は呼べない
put({ at: TRAVEL_PLACES.kitaguchi.at })
TR.startTravel(ch, { to: 'onodera', route: 'auto', time: 'real', cut: 'leg', showSec: 5, fastSec: 30, fastSpeed: null, activity: false, via: 'hover' })
let n = 0
while (ch.rides.hover.step !== 'fly' && n++ < 30 * 300) frame()
out.whileRiding = HR.summonHover(ch)
console.log(JSON.stringify(out))
`

interface Flight {
  length: number
  total: number
  blocked: number
  offWay: number
  minAbove: number
  maxAbove: number
  follow: number
  vmax: number
}

describe('ホバー（character/ride/hoverRide.ts。#9: どこからでも呼んで乗る）', () => {
  const r = Bun.spawnSync([process.execPath, '--eval', PROBE], { cwd: PKG, stderr: 'pipe' })
  const v = (r.exitCode === 0 ? JSON.parse(r.stdout.toString().trim().split('\n').pop()!) : {}) as Record<string, unknown>
  const flightOk = (f: Flight | null) => !!f && f.blocked === 0 && f.offWay === 0 && f.minAbove >= 0.44 && f.maxAbove <= 0.96 && f.vmax <= 12 + 1e-6

  test('まっさらなプロセスで、町の地図データと交通の運行も作って最後まで流せる', () => {
    expect(r.stderr.toString()).not.toMatch(/Error/)
    expect(r.exitCode).toBe(0)
  })

  test('町の道のデータが無い間・乗っている間は呼べない（理由の字）', () => {
    expect(typeof v.beforeData).toBe('string')
    expect(typeof v.whileRiding).toBe('string')
  })

  test('町のどこ（道・広場・坂・石段の踊り場・橋・ラボの前・建物の前）で呼んでも、近くの道・広場の上に来る（遠くからは、すぐ横に現れる）', () => {
    const rows = v.spots as { id: string; error: string | null; phase: string; d: number; dy: number; onWay: boolean; blocked: boolean; tram: boolean; sideNear: number }[]
    expect(rows.length).toBe(12)
    const wrong = rows.filter((x) => x.error !== null || x.phase !== 'parked' || x.d > 9 || Math.abs(x.dy) > 0.8 || !x.onWay || x.blocked || x.tram || x.sideNear > x.d + 0.3)
    expect(wrong).toEqual([])
    // ほとんどはすぐそば（3m の内）
    expect(rows.filter((x) => x.d <= 3).length).toBeGreaterThanOrEqual(9)
  })

  test('ラボ・中のある建物の中で呼ぶと、外の出入口の前の近くに来る', () => {
    const rows = v.inside as { place: string; zone: string; error: string | null; phase: string; portalD: number; onWay: boolean }[]
    expect(rows.map((x) => x.zone)).toEqual(['lab', 'lab', 'thompson', 'cafe', 'seizu'])
    expect(rows.filter((x) => x.error !== null || x.phase !== 'parked' || x.portalD > 9 || !x.onWay)).toEqual([])
  })

  test('100m の内で呼ぶと、ファンを回して飛んで来て、横に下りて待つ。飛ぶ道は建物・木・街灯にかからず、道の外へ出ず、地面に沿う', () => {
    const rows = v.come as { error: string | null; phase0: string; eta: number; sec: number; from: number; phase: string; d: number; power: number; flight: Flight | null }[]
    expect(rows.length).toBe(3)
    for (const x of rows) {
      expect([x.error, x.phase0, x.phase]).toEqual([null, 'coming', 'parked'])
      expect(x.from).toBeLessThan(100)
      expect(x.d).toBeLessThan(9)
      expect(x.power).toBeGreaterThan(0.5)
      // 来るまでの秒は呼んだときの見込みのとおり
      expect(Math.abs(x.sec - x.eta)).toBeLessThan(0.2)
      expect(flightOk(x.flight)).toBe(true)
    }
  })

  test('飛ぶ道（出入口・町の行き先の近くの間）: 建物・木・擁壁・街灯にかからず、道の外へ出ず、地面から 0.45〜0.95m（0.6m に沿う）。12 m/s より速くない', () => {
    const rows = v.flights as ({ from: string; to: string; error?: string } & Flight)[]
    expect(rows.length).toBeGreaterThanOrEqual(30)
    expect(rows.filter((x) => x.error)).toEqual([])
    expect(rows.filter((x) => !flightOk(x)).map((x) => [x.from, x.to, x.blocked, x.offWay, x.minAbove, x.maxAbove])).toEqual([])
    // 長い道では、ほとんどの所で地面 + 0.6m に沿う（坂・段の変わり目をならした分だけ違う）
    expect(rows.filter((x) => x.follow > 0.36)).toEqual([])
    // 長い道は速く飛ぶ（いちばん速い所が 12 m/s）
    expect(rows.filter((x) => x.length > 300 && x.vmax < 12 - 1e-6)).toEqual([])
  })

  test('旅程の via=hover: 呼んで乗り、行き先の近くまで飛んで下りて降り、歩いて着く。どの時間の扱いでも同じ所で、ホバーは下りた所に置いてある', () => {
    const rows = v.travel as { o: string; to: string; time: string; problem?: string; segs: string; error: string | null; x: number; z: number; stopId: string | null; steps: string; board: number; alight: number; home: number | null; flight: Flight | null; d?: number }[]
    const walked = v.walked as Record<string, [number, number]>
    expect(rows.length).toBe(16)
    expect(rows.filter((x) => x.problem || x.error || !x.segs.includes('hover'))).toEqual([])
    for (const x of rows) {
      // 歩いて行ったときと同じ所に着く（町の行き先は行き先の点のそば。街灯・木の幹から離した所。小野寺時計店は店の前の歩ける所の縁）
      const w = walked[`${x.o}>${x.to}`]!
      expect([x.o, x.to, x.time, Math.hypot(x.x - w[0], x.z - w[1]) < 0.3]).toEqual([x.o, x.to, x.time, true])
      if (x.d !== undefined) expect(x.d).toBeLessThan(x.to === 'onodera' ? 6.5 : 1)
      if (x.to === 'thompson-desk' || x.to === 'soranowa-front') expect(x.stopId).toBe(x.to)
      // ホバーは行き先の近くの下りた所（一度に着く cut=none は飛ばずにそこへ置く）
      expect(x.home).not.toBeNull()
      expect(x.home!).toBeLessThan(0.05)
      if (x.time === 'none') continue
      // 乗り込み → 回す → 飛ぶ → 下りる → 降りる
      for (const s of ['board', 'power', 'fly', 'land', 'out']) expect(x.steps.split(' ')).toContain(s)
      expect([x.board, x.alight]).toEqual([1, 1])
      expect(flightOk(x.flight)).toBe(true)
    }
    const by = new Map<string, typeof rows>()
    for (const x of rows) by.set(`${x.o}>${x.to}`, [...(by.get(`${x.o}>${x.to}`) ?? []), x])
    const apart: string[] = []
    for (const [k, list] of by) for (const x of list) if (Math.hypot(x.x - list[0].x, x.z - list[0].z) > 0.05) apart.push(`${k} ${x.time}`)
    expect(apart).toEqual([])
  })
})
