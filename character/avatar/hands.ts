import type { PlaceAction } from '../../core/places'

/**
 * 手の形（指の曲げ・親指・指の開き・前腕のひねり・手首）。体の姿勢（body.ts の BodyPose）の一部として、
 * 行動・反応ごとに決め、腕と同じ強さで混ぜる。
 * VRM は character/avatar/vrmHands.ts で指の骨（thumb / index / middle / ring / little）・
 * 前腕・手首に入れる（関節ごとの角度はそちらで決める）。
 */
export interface HandShape {
  /** 指の曲げ（0 = まっすぐ、1 = 握りこぶし）。人差し指・中指・薬指・小指 */
  index: number
  middle: number
  ring: number
  little: number
  /** 親指の付け根を手のひらの方へ寄せる（0 = 開く、1 = 人差し指・中指の前まで。マイナスで大きく開く） */
  thumbIn: number
  /** 親指の関節の曲げ（0 = まっすぐ、1 = 深く曲げる） */
  thumbCurl: number
  /** 指の開き（0 = そろえる、1 = 大きく開く） */
  spread: number
  /**
   * 前腕のひねり（ラジアン）。腕を下ろしたとき手のひらが体の横を向くのが 0。
   * + で手のひらを後ろ・下へ向ける（回内。前に出した手のひらが下を向く）、- で前・上へ向ける（回外）
   */
  pronate: number
  /** 手首の曲げ（ラジアン。+ で手のひら側へ、- で手の甲側へ反らす） */
  wrist: number
}

/** 手の形の切り替えのなめらかさ（大きいほど速く変わる。1/秒） */
export const HAND_SMOOTHING = 12

export const HAND_KEYS = ['index', 'middle', 'ring', 'little', 'thumbIn', 'thumbCurl', 'spread', 'pronate', 'wrist'] as const

const hand = (
  index: number,
  middle: number,
  ring: number,
  little: number,
  thumbIn: number,
  thumbCurl: number,
  spread: number,
  pronate: number,
  wrist: number,
): Readonly<HandShape> => ({ index, middle, ring, little, thumbIn, thumbCurl, spread, pronate, wrist })

/**
 * 手の形の見本。指は小指の方ほど少し深く曲げると自然に見える。
 * 並び: 人差し指・中指・薬指・小指・親指を寄せる・親指の曲げ・指の開き・前腕のひねり・手首
 */
export const HANDS = {
  /** 力の抜けた手（待機） */
  relaxed: hand(0.2, 0.26, 0.32, 0.38, 0.32, 0.22, 0.12, 0.2, 0.06),
  /** 歩き（待機より少しだけ握る） */
  walk: hand(0.26, 0.32, 0.38, 0.44, 0.36, 0.26, 0.08, 0.25, 0.04),
  /** 工作台・左手: 小さな部品や基板をつまんで支える */
  pinch: hand(0.42, 0.5, 0.6, 0.68, 0.72, 0.36, 0.06, 1.05, 0.12),
  /** 工作台・右手: はんだごてをペンのように持つ（工具は kanon/handTool.ts が手に付ける） */
  tool: hand(0.32, 0.48, 0.74, 0.86, 0.62, 0.3, 0.02, 0.9, 0.05),
  /** 開発デスク: 指を軽く曲げてキーに置く（手のひらは下向き） */
  keys: hand(0.32, 0.36, 0.4, 0.46, 0.3, 0.16, 0.1, 1.35, -0.26),
  /** ホロテーブル・右手: 人差し指を伸ばして指先で操作する */
  point: hand(0.06, 0.52, 0.66, 0.74, 0.5, 0.34, 0.06, 1.0, -0.05),
  /** ホロテーブル・左手: 指を少し開いて、指先で触れる */
  touch: hand(0.1, 0.2, 0.3, 0.4, 0.24, 0.12, 0.32, 0.95, -0.38),
  /** 後ろで手を組む */
  clasp: hand(0.48, 0.52, 0.56, 0.6, 0.45, 0.35, 0.02, 0, 0.1),
  /** 窓に手を当てる（開いた手を反らす） */
  palm: hand(0.08, 0.1, 0.12, 0.16, 0.1, 0.06, 0.22, 1.1, -0.55),
  /** KB-001 をなでる（手のひらを下に、指をそろえて軽く曲げる） */
  stroke: hand(0.16, 0.18, 0.2, 0.24, 0.2, 0.1, 0.05, 1.3, 0.1),
  /** 開いた手（両手を上げる） */
  open: hand(0.04, 0.05, 0.07, 0.1, 0.02, 0.04, 0.4, 0, -0.05),
  /** 手を振る（開いた手の手のひらを前へ向ける） */
  wave: hand(0.04, 0.05, 0.07, 0.1, 0.05, 0.04, 0.26, 0.05, -0.12),
  /** 握りこぶし（ガッツポーズ） */
  fist: hand(0.98, 1, 1, 1, 0.78, 0.9, 0, 0, 0.05),
  /** 軽く握った手（ガッツポーズの反対の手） */
  looseFist: hand(0.6, 0.66, 0.72, 0.78, 0.5, 0.45, 0, 0.3, 0.08),
  /** あごに当てる手（コメントを読む） */
  chin: hand(0.5, 0.72, 0.8, 0.86, 0.36, 0.3, 0, 0.2, 0.25),
  /** 肘を支える手（コメントを読む） */
  hold: hand(0.4, 0.46, 0.52, 0.58, 0.4, 0.26, 0.04, 0.5, 0.1),
  /** 頭をかく指 */
  scratch: hand(0.46, 0.5, 0.56, 0.62, 0.3, 0.2, 0.1, 0.3, 0.1),
  /** 手で示す（披露。指をそろえて開き、手のひらを上に向ける） */
  offer: hand(0.06, 0.08, 0.1, 0.14, 0.1, 0.06, 0.06, -0.75, -0.08),
} as const satisfies Record<string, Readonly<HandShape>>

/** 立ち寄り先での行動ごとの手の形（左手・右手） */
export const ACTION_HANDS: Record<PlaceAction, { L: Readonly<HandShape>; R: Readonly<HandShape> }> = {
  present: { L: HANDS.relaxed, R: HANDS.relaxed },
  holo: { L: HANDS.touch, R: HANDS.point },
  work: { L: HANDS.pinch, R: HANDS.tool },
  type: { L: HANDS.keys, R: HANDS.keys },
  look: { L: HANDS.clasp, R: HANDS.clasp },
  gaze: { L: HANDS.palm, R: HANDS.relaxed },
  pet: { L: HANDS.relaxed, R: HANDS.stroke },
  sit: { L: HANDS.relaxed, R: HANDS.relaxed },
}

export function createHand(from: Readonly<HandShape> = HANDS.relaxed): HandShape {
  return { ...from }
}

/** 手の形を写す */
export function setHand(out: HandShape, from: Readonly<HandShape>) {
  for (const key of HAND_KEYS) out[key] = from[key]
  return out
}

/** 今の手の形を to へ k だけ近づける（反応・身ぶりを重ねるとき） */
export function lerpHand(out: HandShape, to: Readonly<HandShape>, k: number) {
  if (k <= 0) return out
  for (const key of HAND_KEYS) out[key] += (to[key] - out[key]) * k
  return out
}

/** 2 つの手の形を混ぜる（out = a から b へ k だけ） */
export function blendHand(a: Readonly<HandShape>, b: Readonly<HandShape>, k: number, out: HandShape) {
  for (const key of HAND_KEYS) out[key] = a[key] + (b[key] - a[key]) * k
  return out
}

/** 4 本の指の曲げに足す（打鍵・なでる動きなど） */
export function addCurl(out: HandShape, index: number, middle: number, ring: number, little: number) {
  out.index += index
  out.middle += middle
  out.ring += ring
  out.little += little
  return out
}
