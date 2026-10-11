/**
 * 旅程（character/avatar/travel.ts）の着く所と、町の時刻に足す秒（乗り物にも乗って、最後まで流す）:
 *
 * - 町の行き先（route=auto。歩く・いちばん早い・緑電）: 町の道の経路は、行き先の点を道の上へつないだ所で終わる。そこから行き先の点まで歩いて着く
 *   （前は経路の終わりで止まった。ひらき通りは行き先の北の歩道から 8.4m 南の、緑電の線路の通る道の真ん中）。行き先の点が歩ける所でなければ
 *   （小野寺時計店は店の中の点）、まっすぐ向かって歩ける所の縁の手前まで。どの時間の扱いでも同じ所
 * - 出る所: 今いる所（町の歩道・ソラノワの乗り場の前）から経路の始め（道の上へつないだ点）まで歩く（前は歩き出したコマにそこへ跳んだ）
 * - 道のりが地下の駅自由通路（見えない区間。カット）で終わる（北口へ）: 通路を抜けた所（北口）へ置いて着く（前は通路の南の入口で着いた）
 *
 * 交通の運行（緑電・ケーブル・運河バス・ホバー）は描かずに作り（createTransit）、町の毎コマと同じ順（町の時計 → 交通の時計 → 運行 → 乗る仕組み →
 * 人を動かす）で 1/30 秒ずつ進める。交通の時計は 10:00 から。ほかのテストの表が混ざらないよう、まっさらな bun のプロセスで確かめる
 */
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

const PKG = join(import.meta.dir, '..')

const PROBE = `
const P = ${JSON.stringify(PKG)}
// 看板の絵の canvas の代わり（外観の型・停留所の看板が使う。絵は描かない）
const noop = () => undefined
const ctx2d = new Proxy({}, {
  get: (t, k) => (k in t ? t[k] : k === 'measureText' ? (s) => ({ width: String(s).length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }) : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: noop }) : k === 'getImageData' ? (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : noop),
  set: (t, k, v) => ((t[k] = v), true),
})
globalThis.document = { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx2d }) }
console.info = noop
console.warn = noop
const fs = await import('node:fs')
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
const TR = await import(P + '/character/avatar/travel.ts')
const { TRAVEL_PLACES, ZONE_PORTALS } = await import(P + '/core/travel.ts')
const { WAYPOINTS } = await import(P + '/core/routes.ts')
const read = (f) => JSON.parse(fs.readFileSync(P + '/assets/town/' + f, 'utf8'))
const bin = async (f) => {
  const b = fs.readFileSync(P + '/assets/town/' + f)
  return parseContainer(await gunzip(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)))
}
// 町の地図データと、組み立ての順（ラボのまわりのセット → 外観の型 → 中の決まり → 緑電のホーム → 交通の運行）
const infra = read('infra.json')
const named = read('named.json')
townWalk.init(read('walk.json'), infra)
townData.center = new HeightLayer(await bin('terrain/center.bin'))
townData.overview = new HeightLayer(await bin('terrain/overview.bin'))
townData.infra = infra
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

const ch = createCharacter({ id: 'probe', spawn: 'front', seed: null })
ch.drivers.motion = driveRides
ch.drivers.travel = TR.driveTravel
setWarpPermit((c) => c === ch)
const DT = 1 / 30
let t = 0
let elapsed = 0
let watch = null
// 町の毎コマと同じ順（world/createTown.ts の begin・react/RideDriver.tsx・locomotion）。交通の時計は 10:00 + 描画の時計 + 足した時間
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
  if (watch) watch()
}
const r3 = (v) => Math.round(v * 1000) / 1000
const ORIGINS = {
  lab: null,
  summit: ZONE_PORTALS['cable-summit'][0].town,
  hiraki: TRAVEL_PLACES.hiraki.at,
  kitaguchi: TRAVEL_PLACES.kitaguchi.at,
  hirakiStop: WAYPOINTS.hirakiDori.at,
  soranowa: 'soranowa-front',
  cafe: 'cafe-counter',
}
const start = (o) => {
  TR.cancelTravel(ch)
  for (let i = 0; i < 30 * 60 && (ch.ride.phase !== 'none' || TR.traveling(ch)); i++) frame()
  townWarp.cancel(ch)
  hoverHome.at = 'lab'
  const a = ORIGINS[o]
  if (a === null) placeAt(ch, 'front')
  else if (typeof a === 'string') placeAt(ch, a)
  else placeAtPoint(ch, a[0], -a[1], 0)
  for (let i = 0; i < 3; i++) frame()
  clockWarp.offsetSec = 0
  elapsed = 0
}
const request = (to, time, via) => ({ to, route: via === 'F' ? 'F' : 'auto', time: time === 'none' ? 'cut' : time, cut: time === 'none' ? 'none' : 'leg', showSec: 5, fastSec: 30, fastSpeed: null, activity: false, via: via === 'F' ? 'auto' : via })
/** 着くまで流す（steps = 歩き出しから数えたコマごとの位置の差の最大を見るコマの数） */
const go = (o, to, time, via, steps = 0) => {
  start(o)
  const plan = TR.startTravel(ch, request(to, time, via))
  if (TR.isTravelProblem(plan)) return { o, to, time, via, problem: plan.code }
  const segs = plan.segs.map((s) => (s.kind === 'ride' ? s.vehicle : s.kind === 'cut' ? 'cut:' + s.mode : 'walk'))
  let jump = 0
  let px = ch.motion.position.x
  let pz = ch.motion.position.z
  let n = 0
  while ((TR.traveling(ch) || ch.ride.phase !== 'none') && n++ < 30 * 3600) {
    frame()
    if (n <= steps) {
      jump = Math.max(jump, Math.hypot(ch.motion.position.x - px, ch.motion.position.z - pz))
      px = ch.motion.position.x
      pz = ch.motion.position.z
    }
  }
  for (let i = 0; i < 45; i++) frame()
  const m = ch.motion
  const row = { o, to, time, via, segs: segs.join(' '), x: r3(m.position.x), z: r3(m.position.z), heading: r3(m.heading), error: ch.travel.error, jump: r3(jump) }
  if (TRAVEL_PLACES[to]) {
    const a = TRAVEL_PLACES[to].at
    row.d = r3(Math.hypot(m.position.x - a[0], -m.position.z - a[1]))
    // 行き先の点の方へ 0.6m 先が、町の歩ける所（道・広場の中）か
    const ux = (a[0] - m.position.x) / Math.max(1e-6, row.d)
    const uz = (-a[1] - m.position.z) / Math.max(1e-6, row.d)
    row.onWay = townWalk.onWalkway(m.position.x, m.position.z, 0.2)
    row.aheadOnWay = townWalk.onWalkway(m.position.x + ux * 0.6, m.position.z + uz * 0.6, 0)
    const f = TRAVEL_PLACES[to].face
    row.faceErr = r3(Math.abs(Math.atan2(Math.sin(Math.atan2(f[0] - m.position.x, -f[1] - m.position.z) - m.heading), Math.cos(Math.atan2(f[0] - m.position.x, -f[1] - m.position.z) - m.heading))))
  }
  return row
}
const out = {}

// 1. 町の行き先へ（どの時間の扱いでも）
out.arrive = []
for (const o of ['summit', 'kitaguchi', 'hiraki'])
  for (const to of Object.keys(TRAVEL_PLACES))
    for (const via of ['auto', 'walk', 'tram'])
      for (const time of ['cut', 'fast', 'none']) if (ORIGINS[o] === null || o !== to) out.arrive.push(go(o, to, time, via))
for (const time of ['cut', 'fast', 'none']) out.arrive.push(go('lab', 'hiraki', time, 'F'))
// そのままの時間（短い道のり）: 停留所の前から歩道へ・北口から小野寺時計店へ・駅前広場の店から地下の通路で北口へ
out.real = [go('hirakiStop', 'hiraki', 'real', 'walk'), go('kitaguchi', 'onodera', 'real', 'walk'), go('cafe', 'kitaguchi', 'real', 'walk')]

// 2. 出る所: 歩き出してからのコマごとの位置の差（跳ばない）
out.depart = [go('hiraki', 'onodera', 'real', 'walk', 600), go('soranowa', 'cafe-front', 'real', 'walk', 600)].map((r) => ({ o: r.o, to: r.to, jump: r.jump, error: r.error }))

console.log(JSON.stringify(out))
`

interface Row {
  o: string
  to: string
  time: string
  via: string
  problem?: string
  segs: string
  x: number
  z: number
  heading: number
  error: string | null
  d: number
  onWay: boolean
  aheadOnWay: boolean
  faceErr: number
}
describe('旅程（character/avatar/travel.ts）: 着く所と、町の時刻に足す秒', () => {
  const r = Bun.spawnSync([process.execPath, '--eval', PROBE], { cwd: PKG, stderr: 'pipe' })
  const v = (r.exitCode === 0 ? JSON.parse(r.stdout.toString().trim().split('\n').pop()!) : {}) as Record<string, unknown>

  test('まっさらなプロセスで、交通の運行も作って最後まで流せる', () => {
    expect(r.stderr.toString()).not.toMatch(/Error/)
    expect(r.exitCode).toBe(0)
  })

  test('町の行き先へは、行き先の点まで歩いて着く（店の中の点の小野寺時計店は、店の前の歩ける所の縁）。どの時間の扱いでも同じ所', () => {
    // 地下の道で終わる道のり（北口へ）は次のテスト
    const rows = [...(v.arrive as Row[]), ...(v.real as Row[])].filter((x) => !x.problem && !x.segs.endsWith('cut:underground'))
    expect(rows.length).toBeGreaterThanOrEqual(50)
    expect(rows.filter((x) => x.error)).toEqual([])
    const wrong = rows.filter((x) => {
      // 店の中の点（小野寺時計店）: 歩ける所の上で、行き先の方の 0.6m 先は歩ける所の外
      if (x.to === 'onodera') return !x.onWay || x.aheadOnWay || x.d > 6.5
      return x.d > 0.3
    })
    expect(wrong.map((x) => ({ o: x.o, to: x.to, time: x.time, via: x.via, d: x.d, segs: x.segs }))).toEqual([])
    // 着いたら行き先の向く点の方を向く
    expect(rows.filter((x) => x.faceErr > 0.05).map((x) => [x.o, x.to, x.time, x.via, x.faceErr])).toEqual([])
    // 同じ出る所・行き先・乗り方なら、どの時間の扱いでも同じ所に着く
    const by = new Map<string, Row[]>()
    for (const x of rows) by.set(`${x.o}>${x.to}/${x.via}`, [...(by.get(`${x.o}>${x.to}/${x.via}`) ?? []), x])
    const apart: string[] = []
    for (const [k, list] of by) for (const x of list) if (Math.hypot(x.x - list[0].x, x.z - list[0].z) > 0.05) apart.push(`${k} ${x.time}`)
    expect(apart).toEqual([])
  })

  test('道のりが地下の駅自由通路で終わる（北口へ）ときも、通路を抜けた北口に着く', () => {
    const rows = [...(v.arrive as Row[]), ...(v.real as Row[])].filter((x) => !x.problem && x.segs.endsWith('cut:underground'))
    // 頂上駅の前・ひらき通りから（歩く・いちばん早い・緑電）と、駅前広場の店から
    expect(rows.length).toBeGreaterThanOrEqual(10)
    expect(rows.filter((x) => x.time === 'real').length).toBe(1)
    expect(rows.filter((x) => x.d > 0.3).map((x) => [x.o, x.to, x.time, x.via, x.d])).toEqual([])
  })

  test('出る所から経路の始めまで歩く（町の歩道・ソラノワの乗り場の前から、歩き出したコマに跳ばない）', () => {
    const rows = v.depart as { o: string; to: string; jump: number; error: string | null }[]
    expect(rows.filter((x) => x.error)).toEqual([])
    expect(rows.filter((x) => x.jump > 0.2)).toEqual([])
  })

})
