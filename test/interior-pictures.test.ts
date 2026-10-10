/**
 * 中のある建物の絵のアトラス（world/outdoor/interior/pictures.ts の PictureAtlas。2048² の棚詰め）は建物ごとに 1 枚（#15）:
 *   - アトラスどうしは絵の場所を分け合わない（ほかの建物の絵が先に入っていても、1 棟の絵は左上から同じ並びに入る）
 *   - 中を作るとき（interiors.ts の load）に作って InteriorBuilder に渡し、片付けるとき（unload）に dispose で捨てる。モジュールに 1 枚だけ置かない
 *     （前は 1 枚を「中を作っている建物が 0 のとき」にだけ空けていたので、旅程で建物の作る範囲が続いて重なると絵が積もってあふれ、番号板・ポスターが欠けた）
 *   - canvas は CPU で描く物（willReadFrequently）
 * DOM なしで動く範囲（canvas は作らず、絵の場所（uv）だけを決める）。1 棟の絵が 2048² に収まるかは、形を作る外観の型が要るのでブラウザで確かめる。
 * パッケージの側は実行の時に読む（pictures.ts は DOM の型を使うので、kanon-lab の server/test にあった時に server の tsconfig の型の確かめに入れなかった形。lab-kits.test.ts と同じ）
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(import.meta.dir, '..', 'world', 'outdoor', 'interior')

type UV = [number, number, number, number]
interface Atlas {
  readonly canvas: unknown
  readonly tex: { dispose(): void; addEventListener(type: 'dispose', fn: () => void): void }
  readonly count: number
  readonly height: number
  region(key: string): UV
  flush(): void
  dispose(): void
}
const { PictureAtlas } = (await import(join(DIR, 'pictures.ts'))) as { PictureAtlas: new () => Atlas }

/** 中のコードの文（コメントを除く） */
const code = (file: string) =>
  readFileSync(join(DIR, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

describe('中のある建物の絵のアトラス（建物ごとに 1 枚。#15）', () => {
  test('アトラスどうしは絵の場所を分け合わず、1 棟の中の並びは入れた順の棚詰め', () => {
    const cafe = ['clock-face', 'rail-poster', 'number-plate'] as const
    const alone = new PictureAtlas()
    expect(alone.canvas).toBeNull()
    const want = cafe.map((k) => alone.region(k))
    // 先にほかの建物の絵（ケーブルの駅・トンプソン家）を入れたアトラスがあっても、新しいアトラスのカフェの絵は同じ場所
    const other = new PictureAtlas()
    for (const k of ['cable-gate', 'cable-timetable', 'cable-guide', 'cable-name-summit', 'brainstorm', 'arch-board', 'map-town', 'manuscript', 'magazine']) other.region(k)
    const cafeAtlas = new PictureAtlas()
    expect(cafe.map((k) => cafeAtlas.region(k))).toEqual(want)
    // 初めの絵は左上（u0 は 0 に近く、v1 は 1 に近い）、同じ絵は 2 回目も同じ場所で数えない
    expect(want[0][0]).toBeCloseTo(0.5 / 2048, 9)
    expect(want[0][3]).toBeCloseTo(1 - 0.5 / 2048, 9)
    expect(cafeAtlas.region('rail-poster')).toEqual(want[1])
    expect(cafeAtlas.count).toBe(3)
    expect(other.count).toBe(9)
    // uv はどれも 0〜1 の中（あふれていない）
    for (const r of [...want, ...['cable-gate', 'map-town'].map((k) => other.region(k))]) for (const v of r) expect(v >= 0 && v <= 1).toBe(true)
    expect(cafeAtlas.height).toBeGreaterThan(0)
    expect(cafeAtlas.height).toBeLessThanOrEqual(2048)
  })

  test('dispose でテクスチャを捨てる（片付けた建物の絵の場所は残らない）', () => {
    const a = new PictureAtlas()
    a.region('number-plate')
    a.flush()
    let disposed = 0
    a.tex.addEventListener('dispose', () => disposed++)
    a.dispose()
    expect(disposed).toBe(1)
    expect(a.count).toBe(0)
  })

  test('作るのは中を作るとき（load）で、片付けるとき（unload）に捨てる。モジュールに 1 枚だけ置かない', () => {
    const pictures = code('pictures.ts')
    expect(pictures).not.toMatch(/^(export )?(const|let|var) \w+ = new PictureAtlas\(/m)
    expect(pictures).toMatch(/^export class PictureAtlas \{/m)
    // canvas は CPU で描く物（旅程の途中で新しく作った GPU の canvas は、Chrome で描いた物が消えて透明な黒のままになることがあった）
    expect(pictures).toMatch(/getContext\('2d', \{ willReadFrequently: true \}\)/)
    const interiors = code('interiors.ts')
    const load = interiors.slice(interiors.indexOf('  private load('), interiors.indexOf('  private unload('))
    const unload = interiors.slice(interiors.indexOf('  private unload('), interiors.indexOf('  private windowsOf('))
    expect(load).toMatch(/const atlas = new PictureAtlas\(\)/)
    expect(load).toMatch(/new InteriorBuilder\(model, atlas\)/)
    expect(load).toMatch(/createInteriorPictureMaterial\(u, atlas\.tex\)/)
    expect(unload).toMatch(/lo\.atlas\.dispose\(\)/)
    // ほかの所でアトラスを作らない（決まりを作るときの形を作らない builder はアトラスを持たない）
    expect(interiors.match(/new PictureAtlas\(/g)?.length).toBe(1)
    expect(interiors).toMatch(/new InteriorBuilder\(model, null\)/)
    expect(code('builder.ts')).not.toMatch(/new PictureAtlas\(/)
  })
})
