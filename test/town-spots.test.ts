/**
 * ワープ先（docs/design/map-split.md §8「6-5 で作った形」）: 名前の表（core/spots.ts）と、ワープの部品
 * （character/avatar/teleport.ts の townSpots・teleport・placeAtPoint）の基本。DOM なし。
 *
 * - 名前の表の立ち寄り先が地図の表にあり、外の立ち寄り先で、ゾーンが立つ所の点のゾーンと合う。ホバーの乗り場は無い（#9）。ワープ先の名前・字が重ならない
 * - 町の地図データを読む前のワープ先は名前の表の分だけで、緑電の停留所（地図データから。ホームを置く所は町の組み立てと同じ関数）を足すと、
 *   ホームのある停留所ごとに 1 つ増える
 * - 跳ぶと、立つ所・ゾーン・向きのとおりに置かれ、置き直した回数が増えて 'place' が出る。旅程の早送りの倍率と歩幅は戻る
 *
 * ほかのテストが同じプロセスで使う側の表（configurePlaces）を入れても変わらないよう、direct-walk.test.ts と同じく、まっさらな bun のプロセスで地図の既定の表のまま確かめる。
 * 運河バスの乗り場（岸の高さを地形から決める）・中のある建物の決まり（外観の型から作る）は、ここでは作らない（例のアプリで確かめる）
 */
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

const PKG = join(import.meta.dir, '..')

const PROBE = `
const P = ${JSON.stringify(PKG)}
const fs = await import('node:fs')
const spotsModule = await import(P + '/core/spots.ts')
const { PLACE_SPOTS, SPOT_KINDS } = spotsModule
const { TOWN_PLACES } = await import(P + '/core/places.ts')
const { zoneOfPoint } = await import(P + '/core/interiors.ts')
const { townWalk } = await import(P + '/world/walk/townWalk.ts')
const { setupTramNet, tramNet } = await import(P + '/world/outdoor/transit/trams.ts')
const { createCharacter } = await import(P + '/character/avatar/createCharacter.ts')
const T = await import(P + '/character/avatar/teleport.ts')
const { canStand } = await import(P + '/character/avatar/direct.ts')
const read = (f) => JSON.parse(fs.readFileSync(P + '/assets/town/' + f, 'utf8'))
const infra = read('infra.json')
townWalk.init(read('walk.json'), infra)
const out = {}
out.kinds = SPOT_KINDS.map((k) => k.id)
out.places = PLACE_SPOTS.map((s) => {
  const p = TOWN_PLACES[s.place]
  return { place: s.place, kind: s.kind, have: !!p, outdoor: p?.outdoor === true, zone: p ? (p.zone ?? 'lab') : null, pointZone: p ? zoneOfPoint(p.position[0], p.position[2]) : null }
})
out.exports = Object.keys(spotsModule).sort()
const brief = (list) => list.map((s) => ({ id: s.id, kind: s.kind, label: s.label, place: s.place, zone: s.zone, x: s.x, z: s.z, heading: s.heading, refY: s.refY }))
out.before = brief(T.townSpots())
// 緑電の停留所のホーム（町の組み立て world/outdoor/landscape.ts と同じ関数 setupTramNet。車両・形は作らない）
setupTramNet(infra.transit)
const spots = T.townSpots()
out.after = brief(spots)
out.tramStops = [infra.transit.tramStops.length, tramNet.stops.length]
// 跳ぶ: どのワープ先でも、置き直した回数が増えて 'place' が出る。点のワープ先は立つ所・向き・ゾーンのとおり
const ch = createCharacter({ id: 'probe', spawn: 'front', seed: null })
let places = 0
ch.on('place', () => places++)
out.jumps = spots.map((s) => {
  const serial = ch.motion.placeSerial
  ch.motion.timeScale = 4
  ch.motion.stride = 0.3
  T.teleport(ch, s)
  const m = ch.motion
  return {
    id: s.id,
    serial: m.placeSerial - serial,
    pos: [m.position.x, m.position.y, m.position.z],
    ground: m.ground,
    heading: m.heading,
    zone: m.zone,
    stopId: m.stopId,
    phase: m.phase,
    timeScale: m.timeScale,
    stride: m.stride,
    stand: s.place ? null : canStand(ch, m.position.x, m.position.z, m.ground),
  }
})
out.placeEvents = places
console.log(JSON.stringify(out))
`

interface Spot {
  id: string
  kind: string
  label: string
  place: string | null
  zone: string
  x: number
  z: number
  heading: number
  refY: number | null
}

describe('ワープ先（core/spots.ts・character/avatar/teleport.ts。6-5）', () => {
  const r = Bun.spawnSync([process.execPath, '--eval', PROBE], { cwd: PKG, stderr: 'pipe' })
  const v = (r.exitCode === 0 ? JSON.parse(r.stdout.toString().trim().split('\n').pop()!) : {}) as Record<string, unknown>

  test('まっさらなプロセスで動く', () => {
    expect(r.stderr.toString()).not.toMatch(/Error/)
    expect(r.exitCode).toBe(0)
  })

  test('名前の表: 立ち寄り先は地図の表にあって外の立ち寄り先、ゾーンは立つ所の点のゾーンと同じ。ホバーの乗り場は無い（#9）。種類は一覧の種類', () => {
    const kinds = v.kinds as string[]
    expect(kinds).toEqual(['building', 'cable', 'wheel', 'tram', 'waterbus'])
    const places = v.places as { place: string; kind: string; have: boolean; outdoor: boolean; zone: string | null; pointZone: string | null }[]
    // ラボの前・中のある建物 4 つ・ケーブルの 3 駅・観覧車
    expect(places.map((p) => p.place)).toEqual(['front', 'thompson-front', 'seizu-front', 'cafe-front', 'dome-gate', 'cable-summit-front', 'cable-kaedezaka-front', 'cable-fumoto-front', 'soranowa-front'])
    expect(places.filter((p) => !p.have || !p.outdoor)).toEqual([])
    expect(places.filter((p) => p.zone !== p.pointZone)).toEqual([])
    expect(places.every((p) => kinds.includes(p.kind))).toBe(true)
    // ホバーはどこからでも呼べるので、乗り場のワープ先（HOVER_SPOTS）は無い
    expect(v.exports).toEqual(['PLACE_SPOTS', 'SPOT_KINDS'])
  })

  test('町の地図データを読む前は名前の表の分だけ。緑電の停留所を足すと、ホームのある停留所ごとに 1 つ増える。名前・字は重ならず、位置と向きは数', () => {
    const before = v.before as Spot[]
    expect(before.length).toBe(9)
    expect(before.filter((s) => s.kind === 'tram' || s.kind === 'waterbus')).toEqual([])
    const after = v.after as Spot[]
    const trams = after.filter((s) => s.kind === 'tram')
    // データの停留所 40 のうち、1 系統（環状）の脇の道へ入って戻る所の 3 つ（まるの森南・ドーム西門・楠並木）はホームが無い（緑電も止まらない）ので入らない。
    // 同じ所の町役場前・中央図書館前・一の掘割口は、走る線の角へ寄せたホームに入る（world/outdoor/transit/trams.ts の TRAM_SPUR_STOPS）
    const [data, platforms] = v.tramStops as [number, number]
    expect(data).toBe(40)
    expect(trams.length).toBe(platforms)
    expect(trams.length).toBe(37)
    for (const name of ['町役場前', '中央図書館前', '一の掘割口']) expect(trams.some((s) => s.id === `tram:${name}`)).toBe(true)
    for (const name of ['まるの森南', 'ドーム西門', '楠並木']) expect(trams.some((s) => s.id === `tram:${name}`)).toBe(false)
    expect(after.length).toBe(before.length + trams.length)
    for (const key of ['id', 'label'] as const) expect(new Set(after.map((s) => s[key])).size).toBe(after.length)
    expect(after.filter((s) => ![s.x, s.z, s.heading].every(Number.isFinite))).toEqual([])
    // 立ち寄り先のワープ先は立ち寄り先へ置き、ほかは点（ホーム・乗り場の高さの目安は緑電だけ）
    expect(after.filter((s) => (s.place !== null) !== ['building', 'cable', 'wheel'].includes(s.kind))).toEqual([])
    expect(trams.every((s) => s.refY !== null && Number.isFinite(s.refY))).toBe(true)
  })

  test('跳ぶ: 置き直した回数が増えて place が出る。立つ所・ゾーン・向きのとおりで、高さは数。早送りの倍率と歩幅は戻る。点のワープ先には立てる', () => {
    const after = v.after as Spot[]
    const jumps = v.jumps as { id: string; serial: number; pos: number[]; ground: number; heading: number; zone: string; stopId: string | null; phase: string; timeScale: number; stride: number | null; stand: boolean | null }[]
    expect(jumps.length).toBe(after.length)
    expect(v.placeEvents).toBe(after.length)
    for (const [i, j] of jumps.entries()) {
      const s = after[i]!
      expect([j.id, j.serial, j.phase, j.timeScale, j.stride]).toEqual([s.id, 1, 'idle', 1, null])
      expect([j.pos[0], j.pos[2], j.zone]).toEqual([s.x, s.z, s.zone])
      expect(j.pos.every(Number.isFinite)).toBe(true)
      expect(j.stopId).toBe(s.place)
      if (!s.place) expect(j.heading).toBe(s.heading)
    }
    expect(jumps.filter((j) => j.stand === false).map((j) => j.id)).toEqual([])
  })
})
