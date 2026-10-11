/**
 * 名前のある建物の看板のアトラス（world/outdoor/named/signs.ts の signAtlas。4096² の canvas に看板の絵を描き、テクスチャにして貼る）:
 *   - canvas は CPU で描く物（willReadFrequently）。町を組み立ててから作る大きな GPU の canvas は、Chrome で、描いた看板の絵が
 *     消えて透明のままになることがあった（駅舎の正面の駅名などが、撮るたびに出たり出なかったりした）。中の絵のアトラス（interior/pictures.ts）と同じ形
 *   - 看板の絵は、作ったその context に描く
 * DOM なし（document を差し替えた偽の canvas で、getContext に渡す物と描く先を見る）。ほかのテストが signAtlas を先に作っていてもよいように、
 * 同じ型の新しいアトラスで確かめる
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { signAtlas } from '../world/outdoor/named/signs'

interface Call {
  type: string
  opts: unknown
}
const calls: Call[] = []
const drawn: string[] = []
const realDocument = (globalThis as { document?: unknown }).document

beforeAll(() => {
  ;(globalThis as { document?: unknown }).document = {
    createElement: () => {
      const canvas = { width: 0, height: 0, getContext: (type: string, opts?: unknown) => (calls.push({ type, opts }), ctx) }
      const ctx: unknown = new Proxy(
        { canvas },
        {
          get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : k === 'measureText' ? (s: string) => ({ width: s.length * 10 }) : k === 'fillText' ? (s: string) => drawn.push(s) : () => {}),
          set: () => true,
        },
      )
      return canvas
    },
  }
})
afterAll(() => {
  ;(globalThis as { document?: unknown }).document = realDocument
})

type Atlas = typeof signAtlas
const fresh = () => new (signAtlas.constructor as new () => Atlas)()

describe('名前のある建物の看板のアトラス', () => {
  test('canvas は CPU で描く物（getContext に willReadFrequently: true を渡す）', () => {
    const a = fresh()
    void a.tex
    expect(calls).toEqual([{ type: '2d', opts: { willReadFrequently: true } }])
  })

  test('看板の絵は、作った context に描く（同じ字と見た目の看板は 1 つの絵）', () => {
    const a = fresh()
    const style = { text: '桜見駅', sub: 'SAKURAMI STATION  1872', fg: '#e8c870', bg: null, font: 'serif' as const, bold: true, w: 12, h: 1 }
    const r = a.region(style)
    expect(r).not.toBeNull()
    expect(drawn).toContain('桜見駅')
    expect(a.region({ ...style })).toBe(r)
    expect(calls.every((c) => c.type === '2d' && (c.opts as { willReadFrequently?: boolean } | undefined)?.willReadFrequently === true)).toBe(true)
  })
})
