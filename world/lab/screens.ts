import * as THREE from 'three'
import { createCanvas2D } from '../textures/canvas'
import { insideHall, ROOM } from '../../core/lab/plan'

/**
 * ラボの画面の差し込み口（docs/design/map-split.md §6 の「段 4」・4-2。案の §3.3）。モニタ・機械の表示・ホロのパネルの Canvas を、
 * fps で描き直す動くテクスチャ。中身（描く関数）は作る時に入れ、setContent で差し替える（null で什器の既定の飾りの画面に戻す）。
 * 描き直しを呼ぶのは、その画面を持つ什器の更新の中（今の順の位置）。three だけで作る（R3F の包みは react/labHooks.ts の useCanvasScreen）
 */

/** 画面の中身を描く関数。t は画面を作ってからの経過秒（更新に渡した dt の和） */
export type ScreenDraw = (ctx: CanvasRenderingContext2D, t: number, w: number, h: number) => void

export interface LabScreen {
  /** 画面の名前（'devDesk.center' など。差し込み口の名前） */
  readonly key: string
  /** Canvas の画素 */
  readonly width: number
  readonly height: number
  /** 描き直す回数（毎秒）。カメラがホールの外なら labScreenRate で減らす */
  readonly fps: number
  readonly texture: THREE.CanvasTexture
  /** 中身を差し替える（null で既定の中身に戻す）。最初のコマより前に入れること（次に描くのは描き直しの時） */
  setContent(draw: ScreenDraw | null): void
  /** 1 コマ進める（什器の更新が、今の順の位置で呼ぶ） */
  update(dt: number, camera: THREE.Camera): void
  dispose(): void
}

/**
 * ラボの中の画面（モニタ・機械の表示・ホロのパネル）の Canvas を描き直す回数（毎秒）。カメラがラボのホールの外にいるときは減らす
 * （外からはラボじゅうの画面が一度に見え、そのたびに大きな Canvas をテクスチャへ送り直すのが重かった。夜にラボのまわりの外を歩く間の
 * 約 14〜30 fps の原因。§7 の 174）。ホールの中のカメラ（配信のラボの中の画）は今までどおり
 */
const OUTSIDE_SCREEN_FPS = { near: 4, far: 1, nearDistance: 14 }

export function labScreenRate(fps: number, camera: THREE.Camera): number {
  const p = camera.position
  if (insideHall(p.x, p.z, 0.3) && p.y > -0.5 && p.y < ROOM.height + 0.5) return fps
  const d = Math.hypot(p.x, p.z - ROOM.centerZ)
  return Math.min(fps, d < OUTSIDE_SCREEN_FPS.nearDistance ? OUTSIDE_SCREEN_FPS.near : OUTSIDE_SCREEN_FPS.far)
}

export interface LabScreenOptions {
  /** GPU の異方性フィルタの最大（renderer.getMaxAnisotropy()）。曲面・斜めから見ても文字がつぶれないよう max(8, 最大) にする */
  maxAnisotropy: number
  /** 描き直す回数の決め方（省けば labScreenRate） */
  rate?: typeof labScreenRate
}

/**
 * 毎コマではなく fps で描き直す動く Canvas テクスチャ。最初の更新で描き（溜めを Infinity から始める）、そのあとは 1 / 回数 ごと。
 * 描いたら texture.needsUpdate。前の useCanvasScreen（textures/canvas.ts）の中身と同じ
 */
export function createLabScreen(key: string, w: number, h: number, defaultDraw: ScreenDraw, fps: number, o: LabScreenOptions): LabScreen {
  const { canvas, ctx } = createCanvas2D(w, h)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = Math.max(8, o.maxAnisotropy)
  const rate = o.rate ?? labScreenRate

  let draw = defaultDraw
  let acc = Infinity
  let elapsed = 0

  return {
    key,
    width: w,
    height: h,
    fps,
    texture,
    setContent(next) {
      draw = next ?? defaultDraw
    },
    update(dt, camera) {
      elapsed += dt
      acc += dt
      if (acc < 1 / rate(fps, camera)) return
      acc = 0
      draw(ctx, elapsed, w, h)
      texture.needsUpdate = true
    },
    dispose() {
      texture.dispose()
    },
  }
}
