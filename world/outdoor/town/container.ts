/**
 * 町のデータの入れ物を読む（sync-town の tools/town/container.mjs が書く形）。
 * 'KTWN'・版・見出しの JSON・8 バイトにそろえた型つき配列。全体は gzip（サーバが解いて渡したときは、そのまま読む）
 */

export type TypedArray = Float32Array | Uint32Array | Int32Array | Uint16Array | Int16Array | Uint8Array | Int8Array

const CTORS = {
  f32: Float32Array,
  u32: Uint32Array,
  i32: Int32Array,
  u16: Uint16Array,
  i16: Int16Array,
  u8: Uint8Array,
  i8: Int8Array,
} as const

interface SectionInfo {
  type: keyof typeof CTORS
  offset: number
  length: number
  itemSize: number
}

export interface Container<M = Record<string, unknown>> {
  meta: M
  sections: Record<string, { array: TypedArray; itemSize: number }>
}

/** gzip を解く（DecompressionStream）。gzip でなければそのまま */
export async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const head = new Uint8Array(buf, 0, 2)
  if (head[0] !== 0x1f || head[1] !== 0x8b) return buf
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).arrayBuffer()
}

export async function fetchBinary(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return gunzip(await res.arrayBuffer())
}

export function parseContainer<M = Record<string, unknown>>(buf: ArrayBuffer): Container<M> {
  const view = new DataView(buf)
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
  if (magic !== 'KTWN') throw new Error('町のデータの入れ物ではありません')
  const jsonLength = view.getUint32(8, true)
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, jsonLength))) as { meta: M; sections: Record<string, SectionInfo> }
  const dataStart = 12 + jsonLength + ((8 - ((12 + jsonLength) % 8)) % 8)
  const sections: Container<M>['sections'] = {}
  for (const [name, s] of Object.entries(header.sections)) {
    const Ctor = CTORS[s.type]
    sections[name] = { array: new Ctor(buf, dataStart + s.offset, s.length), itemSize: s.itemSize }
  }
  return { meta: header.meta, sections }
}
