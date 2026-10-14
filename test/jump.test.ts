/**
 * 跳ぶ（character/avatar/jump.ts。例のアプリのスペースキー。#8）:
 *
 * - その場で跳ぶ: 足元の地面から 0.45m 上がって、同じ所の地面へ着く（ラボの前・テラス・ラボの中・見晴らし台・百段石段・トンプソン家の中と前）
 * - 走りながら跳ぶ: 跳んでいる間は踏み切ったときの速さと向きのまま進む
 * - 着く所は歩ける所だけ: いろいろな所から、いろいろな向きへ歩いて・走って跳ぶ（種を決めた乱数）。どのコマも立てる所（canStand）にいて、
 *   着いた所も立てる所で、足元は地面の上
 * - 柵・壁の前で越えない: テラスの手すり・ラボの北の壁・南のガラス壁・西の壁・トンプソン家のリビングの南の壁・百段石段のわきへ向かって、
 *   跳びながら歩いても、跳ばずに歩くより先へは出ない
 * - 天井で止まる: ラボの中（背の高い体）・トンプソン家の屋根裏で、頭が天井の 5cm 下より上へ行かない。跳んでいる間にラボの見学エントランスの扉の下へ
 *   入ったら、扉の上端の 5cm 下で止まる。天井まで余白が無ければ跳ばない
 * - 跳ばないとき: 乗り物に乗っている・座っている・旅程の途中・扉をくぐる途中・もう跳んでいる。跳んでいる途中に旅程が動き出した・
 *   乗り物に乗った・置き直されたら、地面に戻る
 *
 * 中のある建物の決まり（外観の型から作る）も作る（test/travel-arrive.test.ts と同じ組み立て。看板の絵の canvas は描かない代わり）。
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
const { townWalk } = await import(P + '/world/walk/townWalk.ts')
const { townData, HeightLayer } = await import(P + '/world/outdoor/town/townData.ts')
const { parseContainer, gunzip } = await import(P + '/world/outdoor/town/container.ts')
const { site } = await import(P + '/world/outdoor/site/siteModel.ts')
const { buildKit } = await import(P + '/world/outdoor/named/kits/index.ts')
const { namedInteriorParts } = await import(P + '/world/outdoor/named/interiorParts.ts')
const { interiors } = await import(P + '/world/outdoor/interior/interiors.ts')
const { INTERIOR_ZONES, INTERIOR_ZONE_IDS } = await import(P + '/core/interiors.ts')
const { ENTRANCE_DOOR } = await import(P + '/core/lab/plan.ts')
const { mulberry32 } = await import(P + '/core/random.ts')
const { createCharacter } = await import(P + '/character/avatar/createCharacter.ts')
const { updateLocomotion, placeAt, groundHeight } = await import(P + '/character/avatar/locomotion.ts')
const { placeAtPoint } = await import(P + '/character/avatar/teleport.ts')
const D = await import(P + '/character/avatar/direct.ts')
const J = await import(P + '/character/avatar/jump.ts')
const TR = await import(P + '/character/avatar/travel.ts')
const read = (f) => JSON.parse(fs.readFileSync(P + '/assets/town/' + f, 'utf8'))
const bin = async (f) => {
  const b = fs.readFileSync(P + '/assets/town/' + f)
  return parseContainer(await gunzip(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)))
}
// 町の地図データと、組み立ての順（ラボのまわりのセット → 外観の型 → 中の決まり）
const infra = read('infra.json')
const named = read('named.json')
const walk = read('walk.json')
townWalk.init(walk, infra)
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

const ch = createCharacter({ id: 'probe', spawn: 'front', seed: null })
ch.drivers.travel = (c, t, dt) => TR.driveTravel(c, t, dt) || D.driveDirect(c, t, dt)
ch.on('place', () => D.stopDirect(ch))
const m = ch.motion
const DT = 1 / 60
let t = 0
const step = () => {
  t += DT
  updateLocomotion(ch, t, DT)
}
const r3 = (v) => Math.round(v * 1000) / 1000
const stand = () => D.canStand(ch, m.position.x, m.position.z, m.ground)
const head = () => J.headHeight(ch)
// 百段石段の 4 分の 1 の点・見晴らし台へ向かう坂（ラボから 300m より遠い、坂の道の辺の真ん中）
const st = walk.stairs.find((s) => s.id === 'stairs.hyakudan')
const stairs = [st.pts[0][0] + (st.pts[1][0] - st.pts[0][0]) * 0.25, -(st.pts[0][1] + (st.pts[1][1] - st.pts[0][1]) * 0.25)]
const stairsDir = (() => {
  const dx = st.pts[1][0] - st.pts[0][0]
  const dz = -(st.pts[1][1] - st.pts[0][1])
  const l = Math.hypot(dx, dz)
  return [dz / l, -dx / l]
})()
let slope = null
for (let e = 0; e < walk.edges.length && !slope; e++) {
  const ed = walk.edges[e]
  if (ed.k !== 0 || ed.f < 0) continue
  const L = townWalk.nav.edgeLength(e)
  if (L < 30) continue
  const [x0, y0] = townWalk.nav.pointOnEdge(e, L / 2 - 5)
  const [x1, y1] = townWalk.nav.pointOnEdge(e, L / 2 + 5)
  if (Math.hypot(x0, y0) < 300) continue
  const g0 = townWalk.groundY(x0, -y0, 1000)
  const g1 = townWalk.groundY(x1, -y1, 1000)
  if (Math.abs(g1 - g0) / 10 > 0.08 && Math.abs(g1 - g0) / 10 < 0.15) slope = [(x0 + x1) / 2, -(y0 + y1) / 2]
}
/** 置く（立ち寄り先の名前か、町の点 [x, z]） */
const put = (at) => {
  TR.cancelTravel(ch)
  D.stopDirect(ch)
  if (typeof at === 'string') placeAt(ch, at, false)
  else placeAtPoint(ch, at[0], at[1], 0)
  for (let i = 0; i < 10; i++) step()
}
/** 跳び終える（着いてしゃがみ終えるまで。最大 3 秒）まで進め、いちばん高い所（踏み切った所の足元から）と、跳んでいた秒・頭の上の余白の最小を返す */
const finish = (y0, each) => {
  let peak = 0
  let air = 0
  let room = Infinity
  for (let i = 0; i < 180 && m.jump.phase !== 'none'; i++) {
    step()
    if (m.jump.phase === 'air') air += DT
    peak = Math.max(peak, m.position.y - y0)
    room = Math.min(room, J.headroomAt(m.position.x, m.position.z, m.position.y - m.jump.height).top - (m.position.y + head()))
    each?.()
  }
  return { peak: r3(peak), air: r3(air), room: r3(room) }
}
const out = {}

// その場で跳ぶ
out.inPlace = []
for (const at of ['front', 'terrace', 'holotable', 'lookout', 'thompson-front', 'thompson-living', stairs, slope]) {
  put(at)
  const p0 = m.position.clone()
  const problem = J.jump(ch)
  const r = finish(p0.y)
  const g = groundHeight(ch, m.position.x, m.position.z, false, m.position.y)
  out.inPlace.push({ at: typeof at === 'string' ? at : 'point', zone: m.zone, problem, ...r, drift: r3(Math.hypot(m.position.x - p0.x, m.position.z - p0.z)), dy: r3(m.position.y - p0.y), onGround: r3(m.position.y - g), stand: stand(), phase: m.jump.phase })
}

// 走りながら跳ぶ: ラボの前から東へ走り、跳んでいる間の速さと向き
put('front')
D.setDirectInput(ch, { x: 1, z: 0 }, true)
for (let i = 0; i < 60; i++) step()
const runSpeed = m.speed
J.jump(ch)
const speeds = []
const dirs = []
while (m.jump.phase !== 'land') {
  step()
  if (m.jump.phase === 'air') {
    speeds.push(m.speed)
    dirs.push(Math.atan2(m.moveDir.x, m.moveDir.z))
  }
}
// 踏み切ったあとで手を離しても、着くまで同じ速さ
for (let i = 0; i < 30; i++) step()
J.jump(ch)
while (m.jump.phase !== 'air') step()
D.setDirectInput(ch, null)
const coast = []
while (m.jump.phase !== 'land') {
  step()
  if (m.jump.phase === 'air') coast.push(m.speed)
}
out.run = { runSpeed: r3(runSpeed), speedMin: r3(Math.min(...speeds)), speedMax: r3(Math.max(...speeds)), coastMin: r3(Math.min(...coast)), coastMax: r3(Math.max(...coast)), stand: stand() }
for (let i = 0; i < 60; i++) step()

// 着く所は歩ける所だけ（種を決めた乱数で、いろいろな所から・向きへ・速さで）
const rnd = mulberry32(8)
const spots = ['front', 'terrace', 'holotable', 'window', 'workshop', 'lookout', 'parabola', 'thompson-front', 'thompson-living', 'thompson-attic', 'thompson-garage', 'seizu-front', 'cafe-front', 'cafe-terrace', 'dome-gate', 'dome-terrace', 'soranowa-platform', 'cable-summit-platform', 'cable-kaedezaka-platform', 'cable-fumoto-platform', stairs, slope]
out.random = { trials: 0, jumps: 0, landed: 0, bad: [] }
for (let n = 0; n < 88; n++) {
  const at = spots[n % spots.length]
  put(at)
  const a = rnd() * Math.PI * 2
  const run = rnd() < 0.5
  D.setDirectInput(ch, { x: Math.sin(a), z: Math.cos(a) }, run)
  const wait = Math.floor(rnd() * 50)
  out.random.trials++
  for (let i = 0; i < 150; i++) {
    if (i === wait || i === wait + 70) {
      if (J.jump(ch) === null) out.random.jumps++
    }
    const before = m.jump.phase
    step()
    if (!stand()) out.random.bad.push({ at: typeof at === 'string' ? at : 'point', i, x: r3(m.position.x), z: r3(m.position.z), phase: m.jump.phase })
    if (before === 'air' && m.jump.phase === 'land') {
      out.random.landed++
      const g = groundHeight(ch, m.position.x, m.position.z, false, m.ground)
      if (!stand() || m.jump.height !== 0 || Math.abs(m.ground - g) > 0.01) out.random.bad.push({ at: typeof at === 'string' ? at : 'point', i, land: true, dg: r3(m.ground - g) })
    }
  }
  D.setDirectInput(ch, null)
  for (let i = 0; i < 40; i++) step()
}

// 柵・壁の前で越えない: 跳ばずに歩くときと、跳びながら歩くときの、向きへ進んだ長さのいちばん大きい所
const along = (at, dir, jumping) => {
  put(at)
  const p0 = m.position.clone()
  let best = 0
  let ok = true
  D.setDirectInput(ch, { x: dir[0], z: dir[1] }, true)
  for (let i = 0; i < 240; i++) {
    if (jumping) J.jump(ch)
    step()
    best = Math.max(best, (m.position.x - p0.x) * dir[0] + (m.position.z - p0.z) * dir[1])
    if (!stand()) ok = false
  }
  D.setDirectInput(ch, null)
  for (let i = 0; i < 60; i++) step()
  return { best: r3(best), ok }
}
out.barriers = []
for (const [name, at, dir] of [
  ['テラスの手すり', 'terrace', [0, 1]],
  ['ラボの北の壁', 'holotable', [0, -1]],
  ['南のガラス壁', 'window', [0, 1]],
  ['西の壁', 'workshop', [-1, 0]],
  ['トンプソン家のリビングの南の壁', 'thompson-living', [0, 1]],
  ['百段石段のわき', stairs, stairsDir],
  ['百段石段のわき（反対）', stairs, [-stairsDir[0], -stairsDir[1]]],
]) {
  const w = along(at, dir, false)
  const j = along(at, dir, true)
  out.barriers.push({ name, walk: w.best, jump: j.best, ok: w.ok && j.ok })
}

// 天井で止まる
out.ceiling = {}
// ラボの中で、背の高い体（実測の身長 5.5m）: 天井の照明の梁（5.8m）の 5cm 下まで。5.75m なら跳ばない
put('holotable')
ch.anchors.measuredHeight = 5.5
J.jump(ch)
out.ceiling.labTall = finish(m.position.y)
ch.anchors.measuredHeight = 5.75
out.ceiling.labTooTall = [J.jump(ch), m.jump.phase]
ch.anchors.measuredHeight = 0
// トンプソン家の屋根裏（勾配の天井）で、背の高い体（2.3m）
put('thompson-attic')
ch.anchors.measuredHeight = 2.3
const atticTop = J.headroomAt(m.position.x, m.position.z, m.position.y).top
const atticY = m.position.y
J.jump(ch)
out.ceiling.attic = { ...finish(m.position.y), want: r3(Math.min(0.45, atticTop - 0.05 - head() - atticY)) }
ch.anchors.measuredHeight = 0
// 跳んでいる間に、ラボの見学エントランスの扉（上端 2.4m）の下へ入る（体 1.9m。扉の外では頭が 2.41m まで上がる）
put([ENTRANCE_DOOR.x, 3.6])
ch.anchors.measuredHeight = 1.9
D.setDirectInput(ch, { x: 0, z: 1 }, true)
let doorPeak = 0
let freePeak = 0
let doorRoom = Infinity
let started = false
for (let i = 0; i < 120; i++) {
  if (!started && m.position.z > 4.05) started = J.jump(ch) === null
  step()
  const h = J.headroomAt(m.position.x, m.position.z, m.position.y - m.jump.height)
  if (h.door) {
    doorPeak = Math.max(doorPeak, m.jump.height)
    doorRoom = Math.min(doorRoom, h.top - (m.position.y + head()))
  } else freePeak = Math.max(freePeak, m.jump.height)
}
D.setDirectInput(ch, null)
out.ceiling.door = { started, doorPeak: r3(doorPeak), doorRoom: r3(doorRoom), freePeak: r3(freePeak), stand: stand() }
ch.anchors.measuredHeight = 0
for (let i = 0; i < 60; i++) step()

// 跳ばないとき
out.refuse = {}
put([ENTRANCE_DOOR.x, 5.2])
out.refuse.door = [J.jump(ch), m.jump.phase]
put('thompson-desk')
placeAt(ch, 'thompson-desk')
for (let i = 0; i < 10; i++) step()
out.refuse.seat = [J.jump(ch), m.jump.phase]
put('front')
ch.ride.phase = 'riding'
out.refuse.ride = [J.jump(ch), m.jump.phase]
ch.ride.phase = 'none'
const plan = TR.startTravel(ch, { to: 'hiraki', route: 'auto', time: 'real', cut: 'leg', showSec: 5, fastSec: 30, fastSpeed: null, activity: false, via: 'walk' })
out.refuse.travel = [TR.isTravelProblem(plan) ? plan.code : 'ok', J.jump(ch), m.jump.phase]
TR.cancelTravel(ch)
for (let i = 0; i < 10; i++) step()
J.jump(ch)
out.refuse.twice = [J.jump(ch), m.jump.phase]
finish(m.position.y)
// 跳んでいる途中に、旅程が動き出した・乗り物に乗った・置き直された
const midAir = (fn) => {
  put('front')
  J.jump(ch)
  for (let i = 0; i < 20; i++) step()
  const before = [m.jump.phase, r3(m.jump.height)]
  fn()
  step()
  const after = [m.jump.phase, r3(m.jump.height), r3(m.position.y - m.ground)]
  TR.cancelTravel(ch)
  ch.ride.phase = 'none'
  for (let i = 0; i < 10; i++) step()
  return { before, after }
}
out.cancel = {
  travel: midAir(() => TR.startTravel(ch, { to: 'hiraki', route: 'auto', time: 'real', cut: 'leg', showSec: 5, fastSec: 30, fastSpeed: null, activity: false, via: 'walk' })),
  ride: midAir(() => (ch.ride.phase = 'riding')),
  place: midAir(() => placeAt(ch, 'terrace')),
}
console.log(JSON.stringify(out))
`

describe('跳ぶ（character/avatar/jump.ts。#8）', () => {
  const r = Bun.spawnSync([process.execPath, '--eval', PROBE], { cwd: PKG, stderr: 'pipe' })
  const err = r.stderr.toString()
  const v = (r.exitCode === 0 ? JSON.parse(r.stdout.toString().trim().split('\n').pop()!) : {}) as {
    inPlace: { at: string; zone: string; problem: string | null; peak: number; air: number; room: number; drift: number; dy: number; onGround: number; stand: boolean; phase: string }[]
    run: { runSpeed: number; speedMin: number; speedMax: number; coastMin: number; coastMax: number; stand: boolean }
    random: { trials: number; jumps: number; landed: number; bad: unknown[] }
    barriers: { name: string; walk: number; jump: number; ok: boolean }[]
    ceiling: {
      labTall: { peak: number; room: number }
      labTooTall: [string | null, string]
      attic: { peak: number; room: number; want: number }
      door: { started: boolean; doorPeak: number; doorRoom: number; freePeak: number; stand: boolean }
    }
    refuse: Record<'door' | 'seat' | 'ride' | 'twice', [string | null, string]> & { travel: [string, string | null, string] }
    cancel: Record<'travel' | 'ride' | 'place', { before: [string, number]; after: [string, number, number] }>
  }

  test('組み立てて確かめが最後まで動く', () => {
    expect(r.exitCode === 0 ? '' : err).toBe('')
  })

  test('その場で跳ぶ: 足元の地面から 0.45m 上がり、同じ所の地面へ着く（ラボの前・テラス・ラボの中・見晴らし台・トンプソン家の前と中・百段石段・坂）', () => {
    expect(v.inPlace.length).toBe(8)
    for (const p of v.inPlace) {
      expect({ at: p.at, problem: p.problem }).toEqual({ at: p.at, problem: null })
      expect(p.peak).toBeGreaterThan(0.44)
      expect(p.peak).toBeLessThanOrEqual(0.451)
      // 跳んでいる長さ（√(2h/g) × 2 = 0.61 秒）
      expect(p.air).toBeGreaterThan(0.58)
      expect(p.air).toBeLessThan(0.64)
      expect(p.drift).toBeLessThan(0.001)
      expect(Math.abs(p.dy)).toBeLessThan(0.01)
      expect(Math.abs(p.onGround)).toBeLessThan(0.01)
      expect(p.stand).toBe(true)
      expect(p.phase).toBe('none')
    }
    // 百段石段はトンプソン家のゾーンの中
    expect(v.inPlace.map((p) => p.zone)).toEqual(['lab', 'lab', 'lab', 'lab', 'thompson', 'thompson', 'thompson', 'town'])
  })

  test('走りながら跳ぶ: 跳んでいる間は踏み切ったときの速さのまま進む（手を離しても着くまで落とさない）', () => {
    expect(v.run.runSpeed).toBeGreaterThan(2.4)
    expect(v.run.speedMax - v.run.speedMin).toBeLessThan(0.001)
    expect(v.run.speedMin).toBeGreaterThan(2.4)
    expect(v.run.coastMax - v.run.coastMin).toBeLessThan(0.001)
    expect(v.run.coastMin).toBeGreaterThan(2.4)
    expect(v.run.stand).toBe(true)
  })

  test('着く所は歩ける所だけ: いろいろな所から・向きへ歩いて走って跳んでも、どのコマも立てる所にいて、着いた所の足元は地面', () => {
    expect(v.random.trials).toBe(88)
    expect(v.random.jumps).toBeGreaterThan(100)
    expect(v.random.landed).toBeGreaterThan(100)
    expect(v.random.bad).toEqual([])
  })

  test('柵・壁・石段のわきの前で跳んでも越えない（跳ばずに歩くより先へ出ない）', () => {
    expect(v.barriers.length).toBe(7)
    for (const b of v.barriers) {
      expect({ name: b.name, ok: b.ok }).toEqual({ name: b.name, ok: true })
      expect(b.jump).toBeLessThanOrEqual(b.walk + 0.05)
    }
  })

  test('天井で止まる: 頭が天井の 5cm 下より上へ行かない（ラボの中の背の高い体・屋根裏・跳んでいる間に入った扉の下）。余白が無ければ跳ばない', () => {
    const c = v.ceiling
    // 5.8 − 0.05 − (5.5 + 0.06) = 0.19m
    expect(c.labTall.peak).toBeGreaterThan(0.18)
    expect(c.labTall.peak).toBeLessThan(0.2)
    expect(c.labTall.room).toBeGreaterThan(0.049)
    expect(c.labTooTall).toEqual(['頭の上が低くて跳べません', 'none'])
    expect(c.attic.want).toBeLessThan(0.45)
    expect(c.attic.want).toBeGreaterThan(0.05)
    expect(Math.abs(c.attic.peak - c.attic.want)).toBeLessThan(0.01)
    expect(c.attic.room).toBeGreaterThan(0.049)
    // 扉の外では高く上がり、扉の下では 2.4 − 0.05 − (1.9 + 0.06) = 0.39m まで
    expect(c.door.started).toBe(true)
    expect(c.door.freePeak).toBeGreaterThan(0.39)
    expect(c.door.doorPeak).toBeGreaterThan(0.2)
    expect(c.door.doorPeak).toBeLessThan(0.391)
    expect(c.door.doorRoom).toBeGreaterThan(0.049)
    expect(c.door.stand).toBe(true)
  })

  test('跳ばないとき: 扉をくぐる途中・座っている・乗り物に乗っている・旅程の途中・もう跳んでいる。跳んでいる途中に旅程・乗り物・置き直しが来たら地面に戻る', () => {
    expect(v.refuse.door).toEqual(['扉をくぐる途中は跳べません', 'none'])
    expect(v.refuse.seat).toEqual(['座っている間は跳べません', 'none'])
    expect(v.refuse.ride).toEqual(['乗り物に乗っている間は跳べません', 'none'])
    expect(v.refuse.travel).toEqual(['ok', '町の中の移動（旅程）の途中は跳べません', 'none'])
    expect(v.refuse.twice).toEqual(['もう跳んでいます', 'crouch'])
    for (const k of ['travel', 'ride', 'place'] as const) {
      const c = v.cancel[k]
      expect(c.before[0]).toBe('air')
      expect(c.before[1]).toBeGreaterThan(0.1)
      expect(c.after).toEqual(['none', 0, expect.any(Number)])
      expect(Math.abs(c.after[2])).toBeLessThan(0.05)
    }
  })
})
