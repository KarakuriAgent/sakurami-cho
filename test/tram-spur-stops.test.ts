/**
 * 脇の道へ入って戻る所にある緑電の停留所（world/outdoor/transit/trams.ts の TRAM_SPUR_STOPS・buildTramLines・placeTramPlatforms）:
 *
 * - 設定資料の 1 系統の線は、6 つの停留所へ行くとき脇の道へ入って戻る。地図は行って戻る所を除いて走らせるので、6 つの点は走る線から 58〜136m 離れ、
 *   前はホームの無い付け根で止まって扉を開けていた（ドーム西門・楠並木は並びから消えていた）
 * - 町役場前・中央図書館前・一の掘割口は、走る線の角へ寄せてホームを置き、止まる。まるの森南・ドーム西門・楠並木はホームを置かず、止まらない
 *   （停留所の点・名前は町のデータのまま）
 * - 表に載るのは、点が走る線から 25m より遠い停留所だけ（どの系統でも）。表はほかの系統・ほかの停留所の止まる所とホームを変えない
 *
 * 町の地図データ（道・交通）を読む。止まる所・ホームの平面の位置・時刻は地形の高さによらないので、地形は読まない。
 * ほかのテストの表が混ざらないよう、まっさらな bun のプロセスで確かめる
 */
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

const PKG = join(import.meta.dir, '..')

const PROBE = `
const P = ${JSON.stringify(PKG)}
console.info = () => undefined
console.warn = () => undefined
const fs = await import('node:fs')
const { townWalk } = await import(P + '/world/walk/townWalk.ts')
const { townData } = await import(P + '/world/outdoor/town/townData.ts')
const TR = await import(P + '/world/outdoor/transit/trams.ts')
const read = (f) => JSON.parse(fs.readFileSync(P + '/assets/town/' + f, 'utf8'))
const infra = read('infra.json')
townWalk.init(read('walk.json'), infra)
townData.infra = infra
const { trams, tramStops } = infra.transit
const lines = TR.setupTramNet(infra.transit)
const r2 = (v) => Math.round(v * 100) / 100
const out = {}
// 系統ごとの止まる所（名前・線の上の長さ・着く・出る秒）
const stopsOf = (ls) => ls.map((l) => ({ no: l.data.no, out: l.outStops.map((s) => [s.name, r2(s.d), r2(s.arrive), r2(s.depart)]), back: l.backStops.map((s) => [s.name, r2(s.d), r2(s.arrive), r2(s.depart)]) }))
const platformsOf = (list) => Object.fromEntries(list.map((st) => [st.name, st.platforms.map((q) => [q.no, r2(q.d), r2(q.x), r2(q.y), r2(q.dx), r2(q.dy), q.side])]))
out.lines = stopsOf(lines)
out.platforms = platformsOf(TR.tramNet.stops)
// 表（無ければ空。直す前の木）
out.table = TR.TRAM_SPUR_STOPS ?? {}
// 停留所の点から、その停留所の最初の系統の走る線まで
out.offLine = tramStops.map((s) => ({ name: s.name, line: s.lines[0], dist: r2(lines.find((l) => l.data.no === s.lines[0]).path.project(s.x, s.y).dist) }))
// ホームのある停留所: ホームの沿う系統と線の上の長さ、その所の線の中心と停留所の点の間
out.moved = {}
const pp = { x: 0, y: 0, z: 0, dx: 1, dy: 0, grade: 0 }
for (const st of TR.tramNet.stops) {
  const s = tramStops.find((q) => q.name === st.name)
  out.moved[st.name] = st.platforms.map((q) => {
    lines.find((l) => l.data.no === q.no).path.at(q.d, pp)
    return { no: q.no, d: r2(q.d), fromPoint: r2(Math.hypot(pp.x - s.x, pp.y - s.y)) }
  })
}
// 扉を開けて止まる所には、どれもホームがある（tramStopPose。乗る仕組み・旅程の乗り場が使う）
out.noPlatform = []
for (const l of lines)
  for (const dir of [1, -1]) {
    const list = dir > 0 ? l.outStops : l.backStops
    list.forEach((s, i) => {
      if (s.name && !TR.tramStopPose(l, dir, i)) out.noPlatform.push(l.data.no + ':' + s.name)
    })
  }
// 1 系統の 1 便を 0.5 秒ごとに見て、扉が開いている間の停留所の名前（止まらない停留所では開かない）
const l1 = lines.find((l) => l.data.no === 1)
const opened = new Set()
const st = { open: 0, stop: -1, dir: 1 }
for (let tau = 0; tau <= l1.span; tau += 0.5) {
  TR.tramDoorState(l1, 0, l1.deps[0] + tau, st)
  if (st.open > 0) opened.add((st.dir > 0 ? l1.outStops : l1.backStops)[st.stop].name)
}
out.opened = [...opened]
// 旅程の乗り場: 1 系統で寄せた停留所の間は乗れて、止まらない停留所には乗れない
const t = 10 * 3600
const ride = (a, b) => !!TR.nextTramBoarding(l1, a, b, t)
out.rides = { yakubaToHoriwari: ride('町役場前', '一の掘割口'), toshoToEki: ride('中央図書館前', '桜見駅前'), ekiToYakuba: ride('桜見駅前', '町役場前'), horiwariToMaruSouth: ride('一の掘割口', 'まるの森南'), kusunokiToEki: ride('楠並木', '桜見駅前') }
// 表を外した形（直す前の止まり方）と比べる: 表の 6 つの停留所と 1 系統の時刻のほかは同じ
if (TR.TRAM_SPUR_STOPS) {
  const saved = TR.TRAM_SPUR_STOPS[1]
  delete TR.TRAM_SPUR_STOPS[1]
  const plain = TR.buildTramLines(trams)
  out.plainLines = stopsOf(plain)
  out.plainPlatforms = platformsOf(TR.placeTramPlatforms(plain, tramStops))
  TR.TRAM_SPUR_STOPS[1] = saved
}
console.log(JSON.stringify(out))
`

type StopRow = [string | null, number, number, number]
interface LineRow {
  no: number
  out: StopRow[]
  back: StopRow[]
}
type PlatformRow = [number, number, number, number, number, number, number]
interface Probe {
  lines: LineRow[]
  platforms: Record<string, PlatformRow[]>
  table: Record<string, Record<string, { at?: number; pass?: true }>>
  offLine: { name: string; line: number; dist: number }[]
  moved: Record<string, { no: number; d: number; fromPoint: number }[]>
  noPlatform: string[]
  opened: string[]
  rides: Record<string, boolean>
  plainLines?: LineRow[]
  plainPlatforms?: Record<string, PlatformRow[]>
}

const MOVED = ['町役場前', '中央図書館前', '一の掘割口']
const PASSED = ['まるの森南', 'ドーム西門', '楠並木']

describe('脇の道へ入って戻る所の緑電の停留所（world/outdoor/transit/trams.ts）', () => {
  const r = Bun.spawnSync([process.execPath, '--eval', PROBE], { cwd: PKG, stderr: 'pipe' })
  const v = (r.exitCode === 0 ? JSON.parse(r.stdout.toString().trim().split('\n').pop()!) : {}) as Probe

  test('まっさらなプロセスで動く', () => {
    expect(r.stderr.toString()).not.toMatch(/Error/)
    expect(r.exitCode).toBe(0)
  })

  test('1 系統は、寄せた 3 つで止まり、止まらない 3 つを飛ばす（走る順は町のデータの順）', () => {
    const l1 = v.lines.find((l) => l.no === 1)!
    expect(l1.out.map((s) => s[0])).toEqual(['桜見駅前', '時計塔前', 'ドーム正門', 'まるの森東', '町役場前', 'ひらき広場', '中央図書館前', '一の掘割口', '桜見駅前'])
    expect(l1.back).toEqual([])
    // 扉が開くのは止まる停留所だけ
    expect([...v.opened].sort()).toEqual(['桜見駅前', '時計塔前', 'ドーム正門', 'まるの森東', '町役場前', 'ひらき広場', '中央図書館前', '一の掘割口'].sort())
  })

  test('寄せた 3 つにはホームがあり（両側の 2 つ）、止まる所に置かれ、停留所の点から決めた距離。止まらない 3 つにはホームが無い', () => {
    // 止まる所（ホームの真ん中の向かいの線の中心）と停留所の点の間（m）。走る線の、脇の道の付け根の角の手前（TRAM_SPUR_STOPS の at）
    const expected: Record<string, number> = { 町役場前: 107.7, 中央図書館前: 97.0, 一の掘割口: 98.3 }
    const l1 = v.lines.find((l) => l.no === 1)!
    for (const name of MOVED) {
      const pf = v.moved[name]
      expect(pf?.length).toBe(2)
      const d = l1.out.find((s) => s[0] === name)![1]
      for (const q of pf) {
        expect(q.no).toBe(1)
        expect(q.d).toBeCloseTo(d, 1)
        expect(Math.abs(q.fromPoint - expected[name])).toBeLessThan(0.5)
      }
    }
    for (const name of PASSED) expect(v.moved[name]).toBeUndefined()
    // 扉を開けて止まる所には、どれもホームがある（どの系統でも）
    expect(v.noPlatform).toEqual([])
  })

  test('旅程の乗り場: 寄せた停留所の間は 1 系統に乗れ、止まらない停留所には乗れない', () => {
    expect(v.rides).toEqual({ yakubaToHoriwari: true, toshoToEki: true, ekiToYakuba: true, horiwariToMaruSouth: false, kusunokiToEki: false })
  })

  test('表に載るのは、点が走る線から 25m より遠い停留所（1 系統の 6 つ）だけ', () => {
    const far = v.offLine.filter((s) => s.dist > 25).map((s) => `${s.line}:${s.name}`)
    const listed = Object.entries(v.table).flatMap(([no, t]) => Object.keys(t).map((name) => `${no}:${name}`))
    expect(listed.sort()).toEqual(far.sort())
    expect(listed.sort()).toEqual([...MOVED, ...PASSED].map((n) => `1:${n}`).sort())
    // 寄せる物は角の手前（負）、止まらない物は pass
    for (const n of MOVED) expect(v.table[1][n].at).toBeLessThan(0)
    for (const n of PASSED) expect(v.table[1][n]).toEqual({ pass: true })
  })

  test('ほかの系統の止まる所・時刻とホーム、1 系統のほかの停留所のホームは、表を外した形と同じ', () => {
    expect(v.plainLines).toBeDefined()
    expect(v.lines.filter((l) => l.no !== 1)).toEqual(v.plainLines!.filter((l) => l.no !== 1))
    // 1 系統: 止まる停留所の並びの、表の 6 つのほかの止まる所（線の上の長さ）は同じ（時刻は一周の分に合わせ直すので変わる）
    const pos = (l: LineRow) => l.out.filter((s) => ![...MOVED, ...PASSED].includes(s[0]!)).map((s) => [s[0], s[1]])
    expect(pos(v.lines.find((l) => l.no === 1)!)).toEqual(pos(v.plainLines!.find((l) => l.no === 1)!))
    const rest = (m: Record<string, PlatformRow[]>) => Object.fromEntries(Object.entries(m).filter(([name]) => !MOVED.includes(name)))
    expect(rest(v.platforms)).toEqual(rest(v.plainPlatforms!))
    // 表を外すと、寄せた 3 つ・止まらない 3 つにはホームが無い（点が線から遠い）
    for (const name of [...MOVED, ...PASSED]) expect(v.plainPlatforms![name]).toBeUndefined()
  })
})
