/**
 * 旅程（character/avatar/travel.ts）のカット（time=cut。cut=leg は区間ごとに少しだけ歩いて次の区間へ、cut=none は一度に行き先へ）で、
 * 置かれる所が、歩いたとき（早送り）と同じになること:
 *
 * - 足元の高さ・階: カットで置く所の高さを、飛ばした歩く所をたどって決める（点の真上の床のうち、前にいた高さに近い物にしない）。
 *   中のある建物のどの立ち寄り先へも、ラボ・高い所（頂上駅の前）・低い所（小野寺）から、カットでも早送りと同じ階・高さ・位置に着く
 *   （前は、トンプソン家のリビングへ高い所から来ると 1 階の上の屋根裏に立ち、上の階の立ち寄り先へは 1 階に立った）
 * - 道のりの最後: 区間ごとに見せる所を決めても（cut=leg）、道のりの最後の歩く所は短くても残す（乗り物を降りた乗り場の外から行き先までが
 *   短いとき、前は落としていて、乗り場で止まった）。道のりがカットで終わるときは、飛ばした所の終わりへ置く
 *
 * 中のある建物の決まりは、外観の型（看板の絵の場所を決めるのに canvas を使う。ここでは絵を描かない代わりの物）から、ブラウザと同じ関数で作る
 * （部屋・通り道の点・面の数がブラウザと同じ）。乗り物に乗る所（車両の形が要る）はここでは動かさず、道のりの形だけを見る（乗って着く所は
 * 例のアプリで確かめる）。ほかのテストの表が混ざらないよう、まっさらな bun のプロセスで地図の既定の表のまま確かめる
 */
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

const PKG = join(import.meta.dir, '..')

const PROBE = `
const P = ${JSON.stringify(PKG)}
// 看板の絵の canvas の代わり（外観の型が看板の場所を決めるのに使う。絵は描かない）
const noop = () => undefined
const ctx2d = new Proxy({}, {
  get: (t, k) => (k in t ? t[k] : k === 'measureText' ? (s) => ({ width: String(s).length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }) : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: noop }) : noop),
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
const { transitClock } = await import(P + '/world/outdoor/transit/clock.ts')
const { createCharacter } = await import(P + '/character/avatar/createCharacter.ts')
const { updateLocomotion, placeAt } = await import(P + '/character/avatar/locomotion.ts')
const { placeAtPoint } = await import(P + '/character/avatar/teleport.ts')
const TR = await import(P + '/character/avatar/travel.ts')
const { TRAVEL_PLACES, ZONE_PORTALS } = await import(P + '/core/travel.ts')
const { townPlaces } = await import(P + '/core/places.ts')
const read = (f) => JSON.parse(fs.readFileSync(P + '/assets/town/' + f, 'utf8'))
const bin = async (f) => {
  const b = fs.readFileSync(P + '/assets/town/' + f)
  return parseContainer(await gunzip(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)))
}
// 町の地図データ（townData の読み込みと同じ物を、ファイルから）と、組み立ての順（ラボのまわりのセット → 外観の型 → 中の決まり → 緑電のホーム）
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
// 交通の時計は 10:00（ケーブル・緑電が動いている。道順 F が作れる）
transitClock.sec = transitClock.serviceSec = 10 * 3600

const ch = createCharacter({ id: 'probe', spawn: 'front', seed: null })
ch.drivers.travel = TR.driveTravel
let t = 0
const step = (n) => {
  for (let i = 0; i < n; i++) updateLocomotion(ch, (t += 1 / 30), 1 / 30)
}
const r3 = (v) => Math.round(v * 1000) / 1000
const ORIGINS = { lab: null, summit: ZONE_PORTALS['cable-summit'][0].town, onodera: TRAVEL_PLACES.onodera.at, kitaguchi: TRAVEL_PLACES.kitaguchi.at, hiraki: TRAVEL_PLACES.hiraki.at }
const goOrigin = (o) => {
  const a = ORIGINS[o]
  if (a) placeAtPoint(ch, a[0], -a[1], 0)
  else placeAt(ch, 'front')
  step(3)
}
const request = (to, time, cut, extra = {}) => ({ to, route: 'auto', time, cut, showSec: 5, fastSec: 30, fastSpeed: null, activity: true, via: 'walk', ...extra })
const out = { models: [...interiors.models].map(([id, m]) => [id, m.rooms.length, m.nodes.length, m.patches.length]) }

// 1. 中のある建物の立ち寄り先へ、歩いて（ケーブル・乗り物なし）: カット（区間ごと・一度に）と早送り
out.arrive = []
for (const o of ['lab', 'summit', 'onodera']) {
  for (const [id, s] of Object.entries(townPlaces())) {
    if (!s.zone || s.zone === 'lab') continue
    const row = { o, id, want: s.level ?? 0 }
    for (const [name, time, cut] of [['fast', 'fast', 'leg'], ['leg', 'cut', 'leg'], ['none', 'cut', 'none']]) {
      goOrigin(o)
      const plan = TR.startTravel(ch, request(id, time, cut))
      if (TR.isTravelProblem(plan)) {
        row[name] = plan.code
        continue
      }
      let n = 0
      while (TR.traveling(ch) && n++ < 30 * 1200) step(1)
      step(45)
      const m = ch.motion
      row[name] = { level: m.level, y: r3(m.position.y), x: r3(m.position.x), z: r3(m.position.z), stop: m.stopId ?? m.targetId }
    }
    out.arrive.push(row)
  }
}

// 2. 町の行き先へ（歩く・いちばん早い・緑電・道順 F）: 区間ごとのカットの歩く所の最後が、道のりの最後と同じ
const tail = (segs) => {
  const s = segs[segs.length - 1]
  if (!s) return null
  return s.kind === 'walk' ? ['walk', r3(s.pts[s.pts.length - 1].x), r3(s.pts[s.pts.length - 1].z)] : [s.kind]
}
out.tails = []
for (const o of Object.keys(ORIGINS)) {
  for (const to of Object.keys(TRAVEL_PLACES)) {
    for (const [route, via] of [['auto', 'auto'], ['auto', 'walk'], ['auto', 'tram'], ['F', 'auto']]) {
      goOrigin(o)
      const plan = TR.startTravel(ch, request(to, 'cut', 'leg', { route, via }))
      if (TR.isTravelProblem(plan)) continue
      out.tails.push({ o, to, route, via, lastLeg: r3(plan.legs[plan.legs.length - 1].length), plan: tail(plan.segs), run: tail(ch.travel.segs) })
      TR.cancelTravel(ch)
    }
  }
}

// 3. 道のりがカット（飛ばした歩く所）で終わる: 飛ばした所の終わりへ置いて着く
goOrigin('onodera')
TR.startTravel(ch, request('kitaguchi', 'cut', 'leg'))
const segs = ch.travel.segs
const w = segs[segs.length - 1]
segs[segs.length - 1] = { kind: 'cut', leg: w.leg, seconds: 3, mode: 'skip', path: w.pts }
let n = 0
while (TR.traveling(ch) && n++ < 30 * 600) step(1)
const e = w.pts[w.pts.length - 1]
out.endCut = { d: r3(Math.hypot(ch.motion.position.x - e.x, ch.motion.position.z - e.z)), done: !TR.traveling(ch) }
console.log(JSON.stringify(out))
`

interface At {
  level: number
  y: number
  x: number
  z: number
  stop: string | null
}
type Arrive = { o: string; id: string; want: number } & Record<'fast' | 'leg' | 'none', At | string>

describe('旅程のカット（character/avatar/travel.ts）: 置かれる所が、歩いたときと同じ', () => {
  const r = Bun.spawnSync([process.execPath, '--eval', PROBE], { cwd: PKG, stderr: 'pipe' })
  const v = (r.exitCode === 0 ? JSON.parse(r.stdout.toString().trim().split('\n').pop()!) : {}) as Record<string, unknown>

  test('まっさらなプロセスで動き、中のある建物の決まりがブラウザと同じ数で作れる', () => {
    expect(r.stderr.toString()).not.toMatch(/Error/)
    expect(r.exitCode).toBe(0)
    // [ゾーン, 部屋, 通り道の点, 面]（例のアプリの interiors.models と同じ）
    expect(v.models).toEqual([
      ['thompson', 14, 59, 29],
      ['seizu', 2, 15, 7],
      ['cafe', 2, 28, 8],
      ['dome', 7, 276, 221],
      ['soranowa', 1, 29, 9],
      ['cable-summit', 1, 31, 13],
      ['cable-kaedezaka', 0, 37, 19],
      ['cable-fumoto', 1, 21, 11],
    ])
  })

  test('中のある建物のどの立ち寄り先へも、カット（区間ごと・一度に）で早送りと同じ階・高さ・位置に着く', () => {
    const rows = v.arrive as Arrive[]
    const reached = rows.filter((a) => typeof a.fast !== 'string')
    // 3 か所から 32 の立ち寄り先へ（同じゾーンの 2 つと、出入口からの通り道が無いトンプソン家の屋根裏・バルコニーのほかの 88 組）
    expect(reached.length).toBeGreaterThanOrEqual(85)
    const wrong: unknown[] = []
    for (const a of reached) {
      const f = a.fast as At
      if (f.level !== a.want || f.stop !== a.id) wrong.push({ o: a.o, id: a.id, fast: f })
      for (const k of ['leg', 'none'] as const) {
        const c = a[k]
        if (typeof c === 'string' || c.level !== f.level || Math.abs(c.y - f.y) > 0.02 || Math.hypot(c.x - f.x, c.z - f.z) > 0.05 || c.stop !== a.id) wrong.push({ o: a.o, id: a.id, [k]: c, fast: f })
      }
    }
    expect(wrong).toEqual([])
    // 作れない道のりは、どの時間の扱いでも同じ
    expect(rows.filter((a) => typeof a.fast === 'string' && (a.leg !== a.fast || a.none !== a.fast))).toEqual([])
  })

  test('町の行き先へ区間ごとのカット: 道のりの最後の歩く所は短くても残る（緑電を降りた乗り場の外から行き先まで 0.1m 足らずのときも）', () => {
    const tails = v.tails as { o: string; to: string; route: string; via: string; lastLeg: number; plan: unknown[]; run: unknown[] }[]
    expect(tails.length).toBeGreaterThanOrEqual(35)
    expect(tails.filter((x) => JSON.stringify(x.run) !== JSON.stringify(x.plan))).toEqual([])
    // 緑電でひらき通りへ（降りてから行き先までが 0.5m より短い）
    expect(tails.filter((x) => x.via === 'tram' && x.to === 'hiraki' && x.lastLeg < 0.5).length).toBeGreaterThanOrEqual(2)
  })

  test('道のりがカット（飛ばした歩く所）で終わるときは、飛ばした所の終わりへ置いて着く', () => {
    expect(v.endCut).toEqual({ d: 0, done: true })
  })
})
