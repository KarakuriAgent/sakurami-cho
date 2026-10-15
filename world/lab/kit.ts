import * as THREE from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import type { LabMaterials } from '../materials/labMaterials'
import { registerLabKitPlan } from '../../core/lab/kits/plans'
import type { LabKitPlan, LabKitPlanFn, Obstacle, Placement } from '../../core/lab/plan'
import type { LabScreen, ScreenDraw } from './screens'
import { markDynamic } from '../staticMerge'

/**
 * ラボの部品の共通の形（docs/design/map-split.md §6 の「段 4」。案の §2.1）: 1 コマの更新に渡す物・差し込み口・入力の値の結び付け（4-3）と、
 * 什器のキットの口（LabKit・LabKitDef）・登録（registerLabKit）（4-5）。
 *
 * キットの種類は「データの側の plan（kits/<種類>.plan.ts。three を読まない）」と「作る側の create（kits/<種類>.ts）」の組。
 * 既定の種類は kits/index.ts の LAB_KITS（plan だけの既定は kits/plans.ts の LAB_KIT_PLANS）。registerLabKit で差し替える・足す。
 * 置き場所ごとのキットは createLab（createLab.ts）が置き場所の表の順に作る。
 */

/** 1 コマの更新に渡す物（什器と照明は time と camera、殻は renderer と scene も使う） */
export interface LabFrame {
  /** 共有の時計（R3F の clock.elapsedTime と同じ値） */
  time: number
  camera: THREE.Camera
  renderer: WebGPURenderer
  scene: THREE.Scene
}

/** 外から入れる中身（照明の stage・ホロテーブルの投影・ギャラリーのケース） */
export interface LabSlotContent {
  object: THREE.Object3D
  /** 持ち主が、決まった順の位置で毎コマ呼ぶ */
  update?(dt: number, f: LabFrame): void
  dispose?(): void
}

/** 差し込み口。入れ物（object）は持ち主の物の木の中の決まった位置にあり、中身はその子になる */
export interface LabSlot {
  readonly name: string
  readonly object: THREE.Group
  readonly content: LabSlotContent | null
  /** 中身を入れる（前の中身は外して dispose する。null で空に） */
  set(content: LabSlotContent | null): void
  /** 中身の update を呼ぶ（持ち主が呼ぶ） */
  update(dt: number, f: LabFrame): void
  /** 中身を dispose する（入れ物はそのまま） */
  dispose(): void
}

export function createLabSlot(name: string, content: LabSlotContent | null = null): LabSlot {
  const object = new THREE.Group()
  object.name = `slot:${name}`
  // 中身は外から入れ替わり、持ち主が動かす（動く物。動かない物を合わせるときは中を触らない）
  markDynamic(object)
  let current: LabSlotContent | null = null
  const slot: LabSlot = {
    name,
    object,
    get content() {
      return current
    },
    set(next) {
      if (current === next) return
      if (current) {
        object.remove(current.object)
        current.dispose?.()
      }
      current = next
      if (current) object.add(current.object)
    },
    update(dt, f) {
      current?.update?.(dt, f)
    },
    dispose() {
      current?.dispose?.()
    },
  }
  slot.set(content)
  return slot
}

/** source を読むたびに見る入れ物（無い名前は既定の値） */
function channelView<C extends object>(defaults: C, source: () => Partial<C> | null | undefined): Readonly<C> {
  const out = {} as C
  for (const key of Object.keys(defaults) as (keyof C)[]) {
    Object.defineProperty(out, key, {
      enumerable: true,
      get: () => {
        const s = source()
        return s && key in s ? (s[key] as C[keyof C]) : defaults[key]
      },
    })
  }
  return out
}

/**
 * キットの入力の値の入れ物（既定の値入り）と、あとから外の物に結び付ける bind（LabKit の channels・bindChannels）。
 * 読むたびに結び付けた物を見る（写さない。コマの順に頼らない）。結び付けた物に無い名前は既定の値のまま。getter の付いた物を渡せば、
 * 使う側の値をそのまま読める
 */
export function kitChannels<C extends object>(defaults: C): { channels: Readonly<C>; bind(source: Partial<C> | null): void } {
  let source: Partial<C> | null = null
  return {
    channels: channelView(defaults, () => source),
    bind(next) {
      source = next
    },
  }
}

/* -------------------------------------------------------------------------- */
/* 什器のキット（4-5）                                                          */
/* -------------------------------------------------------------------------- */

/** 名前のある位置（インスタンスの側。ワールド）。向きは Y 軸まわり */
export interface LabAnchor {
  /** 「置き場所の id.キットの中の名前」（データの側の anchors.ts の名前と同じ） */
  readonly name: string
  readonly position: THREE.Vector3
  readonly quaternion: THREE.Quaternion
  readonly yaw: number
  /** 画面の前などの大きさ（m） */
  readonly size?: { w: number; h: number }
}

/** 置き場所ごとのキット（createLab が作る） */
export interface LabKit<C extends object = object> {
  /** 置き場所の表の id（アンカーの名前の頭） */
  readonly id: string
  /** キットの種類（登録の名前） */
  readonly kind: string
  readonly object: THREE.Object3D
  /** 毎コマ（置き場所の表の順に、什器の更新の位置で呼ぶ） */
  update(dt: number, f: LabFrame): void
  /** 名前のある位置（キットの中の名前で引く。plan のアンカーと、作った物の行列から出す物） */
  readonly anchors: Readonly<Record<string, LabAnchor>>
  /** 画面の差し込み口（キットの中の名前で引く） */
  readonly screens: Readonly<Record<string, LabScreen>>
  /** 入力の値の入れ物（既定の値入り）。bindChannels で外の物に結び付ける */
  readonly channels: Readonly<C>
  /** 入力の値を外の物に結び付ける（読むたびに source を見る。写さない） */
  bindChannels(source: Partial<C> | null): void
  /** 歩く人とカメラが避ける形（ワールド。plan の障害物） */
  readonly obstacles: readonly Obstacle[]
  /** 外から入れる中身の差し込み口（キットの中の名前で引く） */
  readonly slots: Readonly<Record<string, LabSlot>>
  dispose(): void
}

/**
 * 画面の差し込み口を作る（キットの中の名前・Canvas の画素・既定の中身・描き直す回数）。名前は「置き場所の id.キットの中の名前」になり、
 * ラボの口（labHost.ts の screens）にその名前の中身があれば、作る時に入れて返す（最初のコマからその中身を描く）。描き直す回数の決め方は labScreenRate
 */
export type LabScreenFactory = (name: string, width: number, height: number, defaultDraw: ScreenDraw, fps: number) => LabScreen

/** キットを作る時に渡す物 */
export interface LabKitContext {
  /** 置き場所の id（画面の名前などの頭） */
  readonly id: string
  /** 共有の素材 */
  readonly materials: LabMaterials
  readonly quality: 'high' | 'low'
  /** テクスチャの異方性の最大（renderer の capabilities） */
  readonly maxAnisotropy: number
  /** 画面の差し込み口の作り手（4-6） */
  readonly screens: LabScreenFactory
}

/**
 * 種類の create が返す物（キットの物と毎コマの更新など）。id・種類・plan のアンカー・障害物は createLab が足して LabKit にする。
 * 無い物は空（画面・差し込み口・入力の値が無い種類）
 */
export interface LabKitBody<C extends object = object> {
  object: THREE.Object3D
  update?(dt: number, f: LabFrame): void
  /** plan に無い、作った物から出すアンカー（行列で出す物。plan の同じ名前より優先） */
  anchors?: Readonly<Record<string, LabAnchor>>
  screens?: Readonly<Record<string, LabScreen>>
  /** 入力の値（kitChannels で作る） */
  channels?: { channels: Readonly<C>; bind(source: Partial<C> | null): void }
  slots?: Readonly<Record<string, LabSlot>>
  /** キットが作った物（画面・差し込み口の中身も）を捨てる（共有の素材・キャッシュの物は捨てない） */
  dispose?(): void
}

/** キットの種類（登録の単位） */
export interface LabKitDef<O extends object = object, C extends object = object> {
  readonly kind: string
  /** データの側（three を作らない。読み込みの時の定数にも使う） */
  readonly plan: LabKitPlanFn<O>
  /** 作る側（4-11 から必須。前は R3F の什器のままの種類が省いていた） */
  readonly create: (at: Placement, opts: O | undefined, ctx: LabKitContext) => LabKitBody<C>
}

/** 登録した種類（既定の種類より優先） */
const registered = new Map<string, LabKitDef<any, any>>()

/**
 * キットの種類を登録する（同じ kind なら差し替え。町の名前のある建物の kits と同じ考え方）。ラボを作る前（使う側の起動のとき）に。
 * plan を変える差し替えは、その種類の plan を読む前だけ（kits/plans.ts の registerLabKitPlan。読んだあとは例外）。
 * 既定と同じ plan の関数を渡す差し替え（作る側だけ）は、ラボを作る前ならいつでもよい
 */
export function registerLabKit<O extends object, C extends object>(def: LabKitDef<O, C>): void {
  registerLabKitPlan(def.kind, def.plan)
  registered.set(def.kind, def)
}

/** 登録した種類（無ければ undefined。既定の種類と合わせて引くのは kits/index.ts の labKitDef） */
export function registeredLabKit(kind: string): LabKitDef<any, any> | undefined {
  return registered.get(kind)
}

const _yAxis = new THREE.Vector3(0, 1, 0)

/** plan のアンカー（データ）を、インスタンスの側のアンカー（Vector3・Quaternion）にする。向きは省けば置き場所の向き（anchors.ts と同じ） */
export function anchorsFromPlan(id: string, at: Placement, plan: LabKitPlan): Record<string, LabAnchor> {
  const out: Record<string, LabAnchor> = {}
  for (const [key, a] of Object.entries(plan.anchors)) {
    const yaw = a.yaw ?? at.rotationY
    out[key] = {
      name: `${id}.${key}`,
      position: new THREE.Vector3(...a.p),
      quaternion: new THREE.Quaternion().setFromAxisAngle(_yAxis, yaw),
      yaw,
      ...(a.size ? { size: a.size } : {}),
    }
  }
  return out
}

/** 種類の create が返した物に、置き場所の id・種類・plan のアンカーと障害物を足してキットにする */
export function assembleLabKit<C extends object>(id: string, kind: string, at: Placement, plan: LabKitPlan, body: LabKitBody<C>): LabKit<C> {
  const channels = body.channels ?? kitChannels({} as C)
  const screens = body.screens ?? {}
  const slots = body.slots ?? {}
  return {
    id,
    kind,
    object: body.object,
    update: body.update ? body.update.bind(body) : () => {},
    anchors: { ...anchorsFromPlan(id, at, plan), ...body.anchors },
    screens,
    channels: channels.channels,
    bindChannels: (source) => channels.bind(source),
    obstacles: plan.obstacles,
    slots,
    dispose() {
      body.dispose?.()
    },
  }
}

/* -------------------------------------------------------------------------- */
/* 作った物の控え（キットの dispose）                                            */
/* -------------------------------------------------------------------------- */

/** キットが作った物の控え。dispose で控えた物だけを捨てる（共有の素材・キャッシュの素材とテクスチャ・モジュールの形は控えない） */
export interface Owned {
  /** 捨てる物を控える */
  add<T extends { dispose(): void }>(x: T): T
  /** mesh の形と素材（と InstancedMesh なら mesh そのもの）を控える */
  mesh<T extends THREE.Mesh>(m: T): T
  dispose(): void
}

export function createOwned(): Owned {
  const items = new Set<{ dispose(): void }>()
  return {
    add(x) {
      items.add(x)
      return x
    },
    mesh(m) {
      items.add(m.geometry)
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) items.add(mat)
      if ((m as unknown as THREE.InstancedMesh).isInstancedMesh) items.add(m as unknown as THREE.InstancedMesh)
      return m
    },
    dispose() {
      items.forEach((x) => x.dispose())
      items.clear()
    },
  }
}
