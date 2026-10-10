import * as THREE from 'three'
import { townOptions } from './townHost'

/**
 * ラボの照明の明るさの入力（部屋の灯りと LED。docs/design/map-split.md §4・§6）。ラボの照明は「明るさ」という入力を 1 つ持ち、
 * 使う側がそれを毎コマ入れる（町の口 town.setLabLight（world/createTown.ts）か labLighting.set。kanon-lab は配信の StreamDirector が town.setLabLight。
 * 配信中は落ちる）。
 * 部屋の灯りと LED は、ここに登録した物を明るさに合わせて暗くする（装置の光や配信用のライトは登録しないので、そのまま残る）。
 * 反射用の環境の強さ（scene.environmentIntensity）も、照明（lab/lighting）がここに登録した関数で書く（書くのは照明の側だけ）。
 *
 * 入力はモジュールに 1 つ（照明のインスタンスの物ではない）。照明を作る前（読み込みの間）から入り、町の敷地の殻（site/createSite.ts）も
 * 同じ値（labLight.value）を読むため（4-3）。町は 1 ページに 1 つなので、5-6 で町の口にしたあともモジュールに 1 つのまま（段 4 の仮 1 を決めた）。
 * three だけで作る（段 4 の 4-2）。React の hook（useRoomDimmer）は react/labHooks.ts
 */
type Dimmer = (room: number, flash: number) => void

const dimmers = new Set<Dimmer>()

/** 明るさの入力（labLighting.set に入れる物） */
export interface LabLightInput {
  /** 部屋の明るさ（1 = ふだん。配信中は 0.3 くらい。明滅の前の値） */
  level: number
  /** 床際の LED を光らせる強さ（メンバー加入の光の輪など、0〜1） */
  flash?: number
  /** 特別演出の照明の明滅の強さ（0〜1。明滅の形は照明の側が決める） */
  strobe?: number
}

/**
 * 部屋の照明の明るさ。value は実際の明るさ（1 = ふだん。配信中は 0.3 くらい、特別演出の照明の明滅も入る）で、部屋のライト・LED・
 * ガラス壁からこぼれる光はこの値で明るさを決める（lab/lighting・site/createSite.ts）。level は入れた明るさ（明滅の前）で、
 * 反射用の環境の外の光の打ち消しに使う（lab/lighting/environment.ts）。値は labLighting.set（か setLabLight）で書く
 */
export const labLight = { value: 1, level: 1 }

/**
 * 特別演出の照明の明滅（速い点滅にときどき長い暗転が混じる）。時刻は地図の場面の時計（townOptions().clock.sceneTime。
 * kanon-lab は描画の時計の経過秒）
 */
function strobeOn(t: number) {
  return Math.sin(t * 38) + Math.sin(t * 23.7) * 0.6 > 0.2
}

/** 明るさの入力の口（docs/design/map-split.md §6 の「段 4」。lighting.set） */
export const labLighting = {
  /**
   * 明るさを入れる（毎コマ。光の強さを決める前に）。明滅（strobe）は、点いている間は明るさ 1.25、消えている間は 0.04 へ strobe の割合で寄せる。
   * 登録した照明・発光（と反射用の環境の強さ）をすぐに合わせる
   */
  set(input: LabLightInput) {
    const { level, flash = 0, strobe = 0 } = input
    labLight.level = level
    const room = strobe > 0 ? level + ((strobeOn(townOptions().clock.sceneTime()) ? 1.25 : 0.04) - level) * strobe : level
    setLabLight(room, flash)
  },
}

/**
 * 実際の明るさ（明滅を混ぜた後の値）を入れて、登録した照明・発光を合わせる。room: 部屋の明るさ（0〜1 強）、
 * flash: 床際の LED を光らせる強さ（0〜1）。ふつうは labLighting.set を使う（level もそこで入る）
 */
export function setLabLight(room: number, flash = 0) {
  labLight.value = room
  dimmers.forEach((fn) => fn(room, flash))
}

/** room=1 で base、room=ROOM_LIVE 付近で base×min 程度になるように補間する */
const factor = (room: number, min: number) => min + (1 - min) * room

/**
 * 部屋用の発光マテリアル（共有キャッシュとは別に作り、暗くできるよう登録する）。
 * flashable にすると、メンバー加入などの演出で強く光る（床際の LED ライン）
 */
export function dimmableGlowMaterial(color: THREE.ColorRepresentation, intensity: number, min = 0.12, flashable = false): THREE.MeshBasicMaterial {
  const base = new THREE.Color(color).multiplyScalar(intensity)
  const flashColor = new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.35).multiplyScalar(intensity * 2.4)
  const material = new THREE.MeshBasicMaterial({ color: base.clone(), toneMapped: false })
  dimmers.add((room, flash) => {
    material.color.copy(base).multiplyScalar(factor(room, min))
    if (flashable && flash > 0) material.color.lerp(flashColor, flash)
  })
  return material
}

/**
 * 任意の「明るさ」を部屋の照明に合わせて変える（ライト・シェーダーの uniform など）。apply には min〜1 の割合が渡る。
 * 外す関数を返す（作り直すときは外す）
 */
export function addLabLightDimmer(apply: (k: number) => void, min: number): () => void {
  return onLabLight((room) => apply(factor(room, min)))
}

/** 明るさが入るたびに呼ぶ関数を登録する（実際の明るさ room と、床際の LED の flash が渡る）。外す関数を返す */
export function onLabLight(fn: (room: number, flash: number) => void): () => void {
  const d: Dimmer = (room, flash) => fn(room, flash)
  dimmers.add(d)
  return () => {
    dimmers.delete(d)
  }
}
