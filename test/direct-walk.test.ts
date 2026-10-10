/**
 * 人を直接動かす（WASD・クリックで歩く。character/avatar/direct.ts。docs/design/map-split.md §8「6-3 で作った形」）の基本:
 * 立てる所（canStand）・地面を拾う（pickGround）・点へ歩く（walkToPoint）・向きの入力で歩く（setDirectInput・driveDirect）。
 *
 * DOM なしで動く範囲（ラボの中と敷地・町の地図データの道と石段と橋・ゾーンの出入口の間。中のある建物の決まりは外観の型から作るので、ここでは作らない）。
 * ほかのテストが同じプロセスで使う側の表（configurePlaces・configureNav）を入れても変わらないよう、map-defaults.test.ts と同じく、まっさらな bun のプロセスで
 * 地図の既定の表のまま確かめる。町の地図データ（assets/town/ の walk.json・infra.json）は git に入っている（6-0a）
 */
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

const PKG = join(import.meta.dir, '..')

const PROBE = `
const P = ${JSON.stringify(PKG)}
const THREE = await import('three')
const fs = await import('node:fs')
const { townWalk } = await import(P + '/world/walk/townWalk.ts')
const { createCharacter } = await import(P + '/character/avatar/createCharacter.ts')
const { groundHeight, updateLocomotion } = await import(P + '/character/avatar/locomotion.ts')
const D = await import(P + '/character/avatar/direct.ts')
const { TOWN_PLACES } = await import(P + '/core/places.ts')
const { ZONE_PORTALS } = await import(P + '/core/travel.ts')
const { labNavObstacles } = await import(P + '/core/lab/navData.ts')
const read = (f) => JSON.parse(fs.readFileSync(P + '/assets/town/' + f, 'utf8'))
const walk = read('walk.json')
townWalk.init(walk, read('infra.json'))
const ch = createCharacter({ id: 'probe', spawn: 'front', seed: null })
const at = (id) => [TOWN_PLACES[id].position[0], TOWN_PLACES[id].position[2]]
const stand = (x, z, dy = 0) => D.canStand(ch, x, z, groundHeight(ch, x, z, false, 0) + dy)
const out = {}
// ラボの中と敷地: 立ち寄り先の前とテラスに立てる。家具（通り道だけの物でない障害物）の真ん中には立てない
out.front = stand(...at('front'))
out.terrace = stand(...at('terrace'))
// テラスの手すりの外（地図データの「ラボの前の小径」の線が通るが、セットがやめた道）・手すりの際には立てない
out.beyondRail = [stand(0, 9.5), stand(2.5, 9.2), stand(2.52, 8.95)]
out.furniture = labNavObstacles().filter((o) => !o.navOnly).map((o) => [o.name, o.kind === 'circle' ? stand(o.center[0], o.center[1]) : stand((o.min[0] + o.max[0]) / 2, (o.min[1] + o.max[1]) / 2)])
// 町の道: ラボから 400m より遠い道の辺の真ん中（10 か所）には立て、道の幅の 3 倍横へ外れた所（道も広場も無いとき）には立てない
const nav = townWalk.nav
out.roads = []
let road = null
for (let e = 0; e < walk.edges.length && out.roads.length < 10; e++) {
  const ed = walk.edges[e]
  if (ed.k !== 0 || ed.f < 0) continue
  const L = nav.edgeLength(e)
  const [x, y] = nav.pointOnEdge(e, L / 2)
  if (Math.hypot(x, y) < 400 || L < 20) continue
  const [x2, y2] = nav.pointOnEdge(e, L / 2 + 1)
  const l = Math.hypot(x2 - x, y2 - y)
  const w = walk.feats[ed.f].width
  const ox = x - ((y2 - y) / l) * w * 3
  const oy = y + ((x2 - x) / l) * w * 3
  const off = townWalk.onWalkway(ox, -oy) || townWalk.extraAt(ox, oy) ? null : stand(ox, -oy)
  out.roads.push([stand(x, -y), off])
  road ??= [x, -y]
}
// 水（川の中）・線路（日ノ鉄の線路の上）には立てない
out.water = stand(-450, 695)
out.rail = stand(-572.5, 1357.5)
// 石段（百段石段の 4 分の 1）: 立てる。今の足元より 1m 上・下からは行けない（段は 0.45m まで）
const st = walk.stairs.find((s) => s.id === 'stairs.hyakudan')
const sx = st.pts[0][0] + (st.pts[1][0] - st.pts[0][0]) * 0.25
const sy = st.pts[0][1] + (st.pts[1][1] - st.pts[0][1]) * 0.25
out.stairs = [stand(sx, -sy), stand(sx, -sy, 1), stand(sx, -sy, -1)]
// ゾーンの出入口の間（町の点とゾーンの点の真ん中。中のある建物の決まりが無くても）
out.portals = Object.values(ZONE_PORTALS).flat().map((p) => {
  const b = typeof p.zone === 'string' ? at(p.zone) : p.zone
  return stand((p.town[0] + b[0]) / 2, (-p.town[1] + b[1]) / 2)
})
// 地面を拾う: ラボの中で下へ → 床（y = 0）。ラボの中から横へ → 壁で null。ラボの外の上から屋根へ → 殻で null。南のガラスは通り抜ける
const down = D.pickGround(new THREE.Ray(new THREE.Vector3(0, 3, 2), new THREE.Vector3(0, -1, 0)))
out.pickDown = down ? [down.x, down.y, down.z] : null
out.pickWall = D.pickGround(new THREE.Ray(new THREE.Vector3(0, 1.5, 2), new THREE.Vector3(1, 0, 0)))
out.pickRoof = D.pickGround(new THREE.Ray(new THREE.Vector3(0, 60, 2), new THREE.Vector3(0, -1, 0)))
// 南のガラス越し: テラスの上から中の床へ・中から外のテラスへ
const ray = (a, b) => new THREE.Ray(new THREE.Vector3(...a), new THREE.Vector3(...b).sub(new THREE.Vector3(...a)).normalize())
const inFloor = D.pickGround(ray([0, 1.6, 12], [0, 0, 2]))
out.pickIn = inFloor ? [inFloor.x, inFloor.y, inFloor.z] : null
const outFloor = D.pickGround(ray([0, 1.5, 3], [2.4, -0.02, 8.4]))
out.pickOut = outFloor ? [outFloor.x, outFloor.y, outFloor.z] : null
// 点へ歩く: ラボの前 → テラス（同じグラフ）は歩き出す。町の道へはゾーンをまたぐので理由。立てない所は理由
out.walkSame = D.walkToPoint(ch, ...at('terrace'))
out.goal = D.directState(ch).goal
out.walkCross = road ? D.walkToPoint(ch, road[0], road[1]) : 'no road'
out.walkWater = D.walkToPoint(ch, -450, 695)
D.stopDirect(ch)
// 向きの入力: ラボの前から南東へ 2 秒（60 コマ/秒）。動いて、毎コマ立てる所にいる。手を離すと止まる（止まったコマから driveDirect は false）
ch.drivers.travel = D.driveDirect
const p0 = ch.motion.position.clone()
let always = true
D.setDirectInput(ch, { x: 1, z: 1 })
for (let i = 0; i < 120; i++) {
  updateLocomotion(ch, i / 60, 1 / 60)
  if (!D.canStand(ch, ch.motion.position.x, ch.motion.position.z)) always = false
}
out.moved = ch.motion.position.distanceTo(p0)
out.walking = ch.motion.phase
out.always = always
D.setDirectInput(ch, null)
for (let i = 0; i < 60; i++) updateLocomotion(ch, 2 + i / 60, 1 / 60)
out.stopped = [ch.motion.phase, ch.motion.speed, D.directState(ch).active]
console.log(JSON.stringify(out))
`

describe('人を直接動かす（WASD・クリックで歩く。character/avatar/direct.ts。6-3）', () => {
  test('立てる所・地面を拾う・点へ歩く・向きの入力で歩く（ラボと敷地・町の道と石段・出入口の間。DOM なし）', () => {
    const r = Bun.spawnSync([process.execPath, '--eval', PROBE], { cwd: PKG, stderr: 'pipe' })
    expect(r.exitCode).toBe(0)
    const v = JSON.parse(r.stdout.toString().trim().split('\n').pop()!) as Record<string, unknown>
    expect(v.front).toBe(true)
    expect(v.terrace).toBe(true)
    expect(v.beyondRail).toEqual([false, false, false])
    const furniture = v.furniture as [string, boolean][]
    expect(furniture.length).toBeGreaterThan(5)
    expect(furniture.filter(([, ok]) => ok)).toEqual([])
    const roads = v.roads as [boolean, boolean | null][]
    expect(roads.length).toBe(10)
    expect(roads.every(([on]) => on)).toBe(true)
    // 道も広場も無い横の所（null は横も道だった所）
    expect(roads.filter(([, off]) => off === true)).toEqual([])
    expect(roads.filter(([, off]) => off === false).length).toBeGreaterThan(3)
    expect(v.water).toBe(false)
    expect(v.rail).toBe(false)
    expect(v.stairs).toEqual([true, false, false])
    expect((v.portals as boolean[]).every(Boolean)).toBe(true)
    const down = v.pickDown as number[]
    expect(down[0]).toBeCloseTo(0, 3)
    expect(down[1]).toBeCloseTo(0, 3)
    expect(down[2]).toBeCloseTo(2, 3)
    expect(v.pickWall).toBeNull()
    expect(v.pickRoof).toBeNull()
    const pin = v.pickIn as number[]
    expect(pin[1]).toBe(0)
    expect(pin[2]).toBeCloseTo(2, 1)
    const pout = v.pickOut as number[]
    expect(pout[2]).toBeGreaterThan(7)
    expect(pout[1]).toBeLessThan(0.05)
    expect(v.walkSame).toBeNull()
    expect(v.goal).not.toBeNull()
    expect(v.walkCross).toMatch(/ゾーンをまたぐ/)
    expect(v.walkWater).toMatch(/歩けません/)
    expect(v.moved as number).toBeGreaterThan(0.8)
    expect(v.walking).toBe('walk')
    expect(v.always).toBe(true)
    expect(v.stopped).toEqual(['idle', 0, false])
  })
})
