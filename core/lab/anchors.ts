import { LAB_PLACEMENTS, labKitPlanOf, labPlacement, type LabPlacement } from './placements'
import type { Placement, Vec3 } from './plan'

/**
 * 名前のある位置（アンカー）のデータの側（docs/design/map-split.md §6 の「段 4」）。キットの plan から純データで出すので、
 * モジュールの読み込みの時（と Bun のテスト）にも使える。名前は「置き場所の id」（置き場所の原点）か「置き場所の id.キットの中の名前」。
 * three の物（Vector3・行列）で出すインスタンスの側は createLab.ts の lab.anchors（4-8）。
 * ラボの外のアンカー（置き場所の表に無い名前。使う側の意味の場所など）は registerLabAnchor で足す（4-12。kanon-lab は配信の立ち位置 'stage'）。
 */

export interface LabAnchorData {
  readonly name: string
  /** ワールドの位置 */
  readonly p: Vec3
  /** 向き（Y 軸まわり。ワールド） */
  readonly yaw: number
  /** 画面の前などの大きさ（m） */
  readonly size?: { w: number; h: number }
  /** 置き場所（キットの群の位置と向き） */
  readonly at: Placement
  /** 置き場所の中のローカルの位置と向き（あれば、置き場所と同じ群の子にこのローカルで置くと、行列が什器の中の物と同じになる） */
  readonly local?: { p: Vec3; yaw: number }
}

/** ラボの外のアンカー（名前 → 置き場所） */
const outside = new Map<string, Placement>()

/**
 * ラボの外のアンカーを足す（docs/design/map-split.md §6 の「段 4」・4-12。案の §3.4 の登録簿）。置き場所（位置と向き）で渡し、引くと置き場所の原点と
 * 同じ形（p・yaw は置き場所の位置と向き、local は原点）になる。名前の頭が引く表の置き場所の id なら、表の方を引く（ラボの外のアンカーは表の名前を隠さない）。
 * 同じ名前なら差し替える。外す関数を返す。データの側の値（モジュールの読み込みの時の定数）に効かせるなら、それを読む前に足す。
 * 動く物に付ける形（関数で渡す）は、使う所が来る区切りで作る
 */
export function registerLabAnchor(name: string, at: Placement): () => void {
  outside.set(name, at)
  return () => {
    if (outside.get(name) === at) outside.delete(name)
  }
}

/** 置き場所の原点のアンカー（置き場所の表の id と、ラボの外のアンカー） */
const originAnchor = (name: string, at: Placement): LabAnchorData => ({ name, p: [...at.position], yaw: at.rotationY, at, local: { p: [0, 0, 0], yaw: 0 } })

/** アンカーを引く（無ければ undefined）。表の置き場所の id で始まらない名前は、ラボの外のアンカー（registerLabAnchor）から */
export function findLabAnchor(name: string, placements: readonly LabPlacement[] = LAB_PLACEMENTS): LabAnchorData | undefined {
  const dot = name.indexOf('.')
  const id = dot < 0 ? name : name.slice(0, dot)
  const place = labPlacement(id, placements)
  if (!place) {
    const at = outside.get(name)
    return at ? originAnchor(name, at) : undefined
  }
  const { at } = place
  if (dot < 0) return originAnchor(name, at)
  const a = labKitPlanOf(id, placements)?.anchors[name.slice(dot + 1)]
  if (!a) return undefined
  return { name, p: a.p, yaw: a.yaw ?? at.rotationY, ...(a.size ? { size: a.size } : {}), at, ...(a.local ? { local: a.local } : {}) }
}

/** アンカーを引く（無ければ例外。名前の書き違いを早く見つけるため） */
export function labAnchor(name: string, placements: readonly LabPlacement[] = LAB_PLACEMENTS): LabAnchorData {
  const a = findLabAnchor(name, placements)
  if (!a) throw new Error(`lab: アンカーが無い（${name}）`)
  return a
}

/** 表のアンカーの名前の全部（置き場所の原点と、キットの中の名前。表の順。ラボの外のアンカーは入らない） */
export function labAnchorNames(placements: readonly LabPlacement[] = LAB_PLACEMENTS): string[] {
  return placements.flatMap((p) => [p.id, ...Object.keys(labKitPlanOf(p.id, placements)?.anchors ?? {}).map((k) => `${p.id}.${k}`)])
}
