/**
 * 例のアプリ town-walker の、入口のページで選んだ VRM の確かめとサムネイル（examples/town-walker/src/vrmStore.ts の checkVrmFile・readThumbnail）の見張り:
 *   - 名前が .vrm でない・頭が glTF の印でない・短すぎるファイルを断り、.vrm で glTF の頭ならよいとする（VRM として読めるかはアプリが確かめる）
 *   - サムネイルは VRM 1.0（VRMC_vrm.meta.thumbnailImage）・0.x（VRM.meta.texture → textures[].source）の画を、BIN の塊から切り出す。
 *     無い・形の外（-1・buffer が 0 でない・BIN を越える・画でない mimeType）・JSON が壊れているときは null
 * GLB は小さな物をこのテストで組む（IndexedDB は使わない）
 */
import { describe, expect, test } from 'bun:test'
import { checkVrmFile, readThumbnail } from '../examples/town-walker/src/vrmStore.ts'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5])

/** JSON と BIN の塊から GLB を組む（どちらも 4 バイトにそろえる） */
function glb(json: unknown, bin: Uint8Array): Uint8Array<ArrayBuffer> {
  let text = new TextEncoder().encode(JSON.stringify(json))
  const jsonPad = (4 - (text.length % 4)) % 4
  const jsonBytes = new Uint8Array(text.length + jsonPad).fill(0x20)
  jsonBytes.set(text)
  text = jsonBytes
  const binPad = (4 - (bin.length % 4)) % 4
  const total = 12 + 8 + text.length + 8 + bin.length + binPad
  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, 0x46546c67, true)
  dv.setUint32(4, 2, true)
  dv.setUint32(8, total, true)
  dv.setUint32(12, text.length, true)
  dv.setUint32(16, 0x4e4f534a, true)
  out.set(text, 20)
  const b = 20 + text.length
  dv.setUint32(b, bin.length + binPad, true)
  dv.setUint32(b + 4, 0x004e4942, true)
  out.set(bin, b + 8)
  return out
}

/** BIN の塊の 8 バイト目からの PNG を images[1] に持つ glTF の JSON */
function withImage(extensions: unknown, image: Record<string, unknown> = {}) {
  return {
    asset: { version: '2.0' },
    extensions,
    buffers: [{ byteLength: 8 + PNG.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 8 },
      { buffer: 0, byteOffset: 8, byteLength: PNG.length },
    ],
    images: [{ bufferView: 0, mimeType: 'image/jpeg' }, { bufferView: 1, mimeType: 'image/png', ...image }],
    textures: [{ source: 0 }, { source: 1 }],
  }
}

function bin(): Uint8Array {
  const b = new Uint8Array(8 + PNG.length)
  b.set(PNG, 8)
  return b
}

const file = (bytes: Uint8Array<ArrayBuffer> | string, name: string) => new File([bytes], name)

describe('入口で選んだ VRM の確かめ', () => {
  test('.vrm で glTF の頭ならよい', async () => {
    expect(await checkVrmFile(file(glb(withImage({}), bin()), 'a.VRM'))).toBeNull()
  })
  test('名前が .vrm でなければ断る', async () => {
    expect(await checkVrmFile(file(glb(withImage({}), bin()), 'a.glb'))).toContain('.vrm')
  })
  test('頭が glTF の印でない・短すぎるファイルを断る', async () => {
    expect(await checkVrmFile(file('this is not a glTF file at all', 'broken.vrm'))).toContain('glTF')
    expect(await checkVrmFile(file('glTF', 'short.vrm'))).toContain('短すぎ')
  })
})

describe('VRM のサムネイル', () => {
  test('VRM 1.0 の thumbnailImage の画を切り出す', async () => {
    const img = await readThumbnail(file(glb(withImage({ VRMC_vrm: { meta: { thumbnailImage: 1 } } }), bin()), 'a.vrm'))
    expect(img?.type).toBe('image/png')
    expect(new Uint8Array(await img!.arrayBuffer())).toEqual(PNG)
  })
  test('VRM 0.x の meta.texture から textures[].source の画を切り出す', async () => {
    const img = await readThumbnail(file(glb(withImage({ VRM: { meta: { texture: 1 } } }), bin()), 'a.vrm'))
    expect(img?.type).toBe('image/png')
    expect(new Uint8Array(await img!.arrayBuffer())).toEqual(PNG)
  })
  test('無い・形の外なら null', async () => {
    const cases: [unknown, Record<string, unknown>?][] = [
      [{}],
      [{ VRM: { meta: { texture: -1 } } }],
      [{ VRMC_vrm: { meta: {} } }],
      [{ VRMC_vrm: { meta: { thumbnailImage: 5 } } }],
      [{ VRMC_vrm: { meta: { thumbnailImage: 1 } } }, { mimeType: 'text/html' }],
      [{ VRMC_vrm: { meta: { thumbnailImage: 1 } } }, { bufferView: 9 }],
    ]
    for (const [ext, image] of cases) expect(await readThumbnail(file(glb(withImage(ext, image), bin()), 'a.vrm'))).toBeNull()
    // BIN を越える所を指す
    const over = withImage({ VRMC_vrm: { meta: { thumbnailImage: 1 } } })
    over.bufferViews[1]!.byteLength = 1000
    expect(await readThumbnail(file(glb(over, bin()), 'a.vrm'))).toBeNull()
    // JSON が壊れている・glTF でない
    const broken = glb(withImage({}), bin())
    broken[22] = 0x7b
    broken[23] = 0x7b
    expect(await readThumbnail(file(broken, 'a.vrm'))).toBeNull()
    expect(await readThumbnail(file('not a glTF file, just some text', 'a.vrm'))).toBeNull()
  })
})
