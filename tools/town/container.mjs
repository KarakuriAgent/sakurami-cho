// 町のデータの入れ物（pnpm sync:town が書き、world/outdoor/town/container.ts が読む）。
// 形: 'KTWN'・版（u32）・見出しの JSON の長さ（u32）・見出しの JSON（UTF-8）・8 バイトにそろえた型つき配列の並び。全体を gzip する。
// 見出し: { meta: {...}, sections: { 名前: { type: 'f32' | 'u32' | 'i32' | 'u16' | 'i16' | 'u8' | 'i8', offset, length, itemSize } } }
import { gzipSync } from 'node:zlib'

export const CONTAINER_VERSION = 1

const TYPES = new Map([
  [Float32Array, 'f32'],
  [Uint32Array, 'u32'],
  [Int32Array, 'i32'],
  [Uint16Array, 'u16'],
  [Int16Array, 'i16'],
  [Uint8Array, 'u8'],
  [Int8Array, 'i8'],
])

/** sections: { 名前: { array: 型つき配列, itemSize?: 1 } }。gzip した Buffer を返す */
export function writeContainer(meta, sections) {
  const header = { meta, sections: {} }
  const blobs = []
  let offset = 0
  for (const [name, s] of Object.entries(sections)) {
    const array = s.array ?? s
    const type = TYPES.get(array.constructor)
    if (!type) throw new Error(`入れ物に入れられない配列です: ${name}`)
    header.sections[name] = { type, offset, length: array.length, itemSize: s.itemSize ?? 1 }
    const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength)
    blobs.push(bytes)
    const pad = (8 - (bytes.length % 8)) % 8
    if (pad) blobs.push(Buffer.alloc(pad))
    offset += bytes.length + pad
  }
  const json = Buffer.from(JSON.stringify(header), 'utf8')
  const head = Buffer.alloc(12)
  head.write('KTWN', 0, 'ascii')
  head.writeUInt32LE(CONTAINER_VERSION, 4)
  head.writeUInt32LE(json.length, 8)
  const headPad = (8 - ((12 + json.length) % 8)) % 8
  return gzipSync(Buffer.concat([head, json, Buffer.alloc(headPad), ...blobs]), { level: 9 })
}
