// PNG の読み書き（依存なし。pnpm sync:town が町の高さ画像を読み、地面の色の画像を書くのに使う）。
// 読み: インターレースなしの 8 / 16 bit のグレー・RGB・RGBA（パレットは使わない）。書き: 8 bit のグレー・RGB・RGBA
import { deflateSync, inflateSync } from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** PNG を読む。data は 1 画素あたり channels 個の値（8 bit は Uint8Array、16 bit は Uint16Array）、行は上から */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('PNG ではありません')
  let pos = 8
  let width = 0
  let height = 0
  let depth = 0
  let colorType = 0
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const body = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      depth = body[8]
      colorType = body[9]
      if (body[12] !== 0) throw new Error('インターレースの PNG は読めません')
    } else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]
  if (!channels || (depth !== 8 && depth !== 16)) throw new Error(`この PNG の形式は読めません（色 ${colorType}・${depth} bit）`)
  const raw = inflateSync(Buffer.concat(idat))
  const bpp = (channels * depth) / 8
  const stride = width * bpp
  const out = Buffer.alloc(stride * height)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const cur = out.subarray(y * stride, (y + 1) * stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[i] = v & 0xff
    }
    prev = cur
  }
  let data
  if (depth === 8) data = new Uint8Array(out.buffer, out.byteOffset, out.length)
  else {
    data = new Uint16Array(width * height * channels)
    for (let i = 0; i < data.length; i++) data[i] = (out[i * 2] << 8) | out[i * 2 + 1]
  }
  return { width, height, depth, channels, data }
}

/** 8 bit の PNG を書く（channels: 1 = グレー、3 = RGB、4 = RGBA）。行ごとに一番小さくなるフィルタを選ぶ */
export function encodePng(width, height, channels, data) {
  const colorType = { 1: 0, 3: 2, 4: 6 }[channels]
  const stride = width * channels
  const raw = Buffer.alloc((stride + 1) * height)
  const cand = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride))
  for (let y = 0; y < height; y++) {
    const cur = data.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? data.subarray((y - 1) * stride, y * stride) : null
    let best = 0
    let bestScore = Infinity
    for (let f = 0; f < 5; f++) {
      const o = cand[f]
      let score = 0
      for (let i = 0; i < stride; i++) {
        const a = i >= channels ? cur[i - channels] : 0
        const b = prev ? prev[i] : 0
        const c = prev && i >= channels ? prev[i - channels] : 0
        let p
        if (f === 0) p = 0
        else if (f === 1) p = a
        else if (f === 2) p = b
        else if (f === 3) p = (a + b) >> 1
        else {
          const q = a + b - c
          const pa = Math.abs(q - a)
          const pb = Math.abs(q - b)
          const pc = Math.abs(q - c)
          p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
        }
        const v = (cur[i] - p) & 0xff
        o[i] = v
        score += v < 128 ? v : 256 - v
      }
      if (score < bestScore) {
        bestScore = score
        best = f
      }
    }
    raw[y * (stride + 1)] = best
    cand[best].copy(raw, y * (stride + 1) + 1)
  }
  const chunk = (type, body) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(body.length, 0)
    head.write(type, 4, 'ascii')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0)
    return Buffer.concat([head, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = colorType
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
