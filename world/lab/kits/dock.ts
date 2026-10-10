import * as THREE from 'three'
import { GLOW, PALETTE } from '../../palette'
import { glowMaterial, type LabMaterials } from '../../materials/labMaterials'
import { createOwned, type LabKitBody, type LabKitContext, type LabKitDef, type Owned } from '../kit'
import { cable } from '../parts/cable'
import { glowSprite, sticker } from '../parts/details'
import { floorPath } from '../parts/geometry'
import { group, mesh, type MeshOptions } from '../parts/object'
import { KB001_DOCK_TOP, type Placement } from '../../../core/lab/plan'
import { dockPlan } from '../../../core/lab/kits/dock.plan'

/**
 * KB-001 のドック（充電台。ギャラリーの横）。床の円形の充電パッド・支柱・上の充電パッドと 3 本の爪・名札、パッドの上のほのかな浮遊フィールド
 * （光のにじみ）、東の壁のコンセントへの電源ケーブル。ローカル座標: 原点 = 床の中心。浮かぶ KB-001 そのものは使う側（kanon-lab の src/kb001/KB001.tsx）。
 *
 * 前の zones/KB001.tsx の Dock・GlowSprite・電源のケーブルと置き場所の群を、同じ入れ子・同じ子の順・同じ作る順（部品ごとに hooks の素材 → JSX の子の順。
 * 子を作ってから群）・手で書いた数と式のまま three の形にした物（docs/design/map-split.md §6 の「段 4」・4-11）。台座の高さ KB001_DOCK_TOP・アンカー
 * （pad・hover）・障害物はデータの側（plan.ts・dock.plan.ts）。キットの object は置き場所の群（位置と向き）。ドックの光は照明の表（印 kb001Dock）
 *
 * - opts（DockOptions）: 支柱の名札の文字（既定は前の文。既定の絵は前と同じキャッシュ）
 * - 毎コマ: 光のにじみ（カメラを向く）
 */

export interface DockOptions {
  /** 支柱の名札（文字と下の小さな文字） */
  label?: { text: string; sub?: string }
}

/** 支柱の名札の既定（前の文） */
export const DOCK_LABEL: Readonly<{ text: string; sub?: string }> = { text: 'KB-001 DOCK', sub: 'CHARGE / CALIB' }

/** 組み立ての間に持ち回る物 */
interface Build {
  mats: LabMaterials
  /** 作った物の控え（共有の素材・キャッシュの発光の素材とテクスチャは控えない） */
  own: Owned
}

/** 形を作って控え、mesh にする（JSX の <mesh><cylinderGeometry/></mesh> など） */
const m = (b: Build, geometry: THREE.BufferGeometry, material: THREE.Material, o?: MeshOptions) => mesh(b.own.add(geometry), material, o)

/** ドック（充電台）。原点は床 */
function dock(b: Build, label: { text: string; sub?: string }): THREE.Group {
  const { mats, own } = b
  const top = KB001_DOCK_TOP
  // 前の Dock の hooks（発光の素材はキャッシュ）
  const ring = glowMaterial(PALETTE.cyan, GLOW.strip)
  const ringDim = glowMaterial(PALETTE.blue, 2)
  return group([
    // 床の円形の充電パッド（資料: 半径 0.45m）
    m(b, new THREE.CylinderGeometry(0.43, 0.45, 0.03, 64), mats.darkMetal, { p: [0, 0.015, 0], cast: true, receive: true }),
    m(b, new THREE.RingGeometry(0.395, 0.402, 96), ringDim, { p: [0, 0.031, 0], r: [-Math.PI / 2, 0, 0] }),
    m(b, new THREE.RingGeometry(0.215, 0.222, 64), ringDim, { p: [0, 0.031, 0], r: [-Math.PI / 2, 0, 0] }),
    // 支柱
    m(b, new THREE.CylinderGeometry(0.085, 0.12, top - 0.08, 32), mats.darkMetal, { p: [0, (top - 0.08) / 2 + 0.03, 0], cast: true, receive: true }),
    // 支柱の縦スリット
    ...[0, 1, 2].map((i) => {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 6
      return m(b, new THREE.BoxGeometry(0.006, top * 0.62, 0.004), ring, { p: [Math.sin(a) * 0.101, top * 0.47, Math.cos(a) * 0.101], r: [0.035, a, 0] })
    }),
    // 充電パッド
    m(b, new THREE.CylinderGeometry(0.2, 0.15, 0.08, 48), mats.blackMetal, { p: [0, top - 0.04, 0], cast: true, receive: true }),
    m(b, new THREE.CircleGeometry(0.2, 48), mats.screenOff, { p: [0, top + 0.001, 0], r: [-Math.PI / 2, 0, 0] }),
    m(b, new THREE.RingGeometry(0.165, 0.175, 64), ring, { p: [0, top + 0.003, 0], r: [-Math.PI / 2, 0, 0] }),
    m(b, new THREE.RingGeometry(0.09, 0.095, 64), ringDim, { p: [0, top + 0.003, 0], r: [-Math.PI / 2, 0, 0] }),
    // パッドを囲む 3 本の爪
    ...[0, 1, 2].map((i) => {
      const a = (i / 3) * Math.PI * 2
      return group(
        [
          m(b, new THREE.BoxGeometry(0.03, 0.12, 0.02), mats.darkMetal, { p: [0, top + 0.05, 0.205], r: [-0.25, 0, 0], cast: true }),
          m(b, new THREE.BoxGeometry(0.012, 0.02, 0.022), ring, { p: [0, top + 0.1, 0.193], r: [-0.25, 0, 0] }),
        ],
        { ry: a },
      )
    }),
    own.mesh(
      sticker({ text: label.text, sub: label.sub, position: [0, 0.55, 0.112], width: 0.11, aspect: 2.2, background: '#0c1118', color: '#9fe6ff', font: 'mono' }),
    ),
  ])
}

export function createDock(at: Placement, opts: DockOptions | undefined, ctx: LabKitContext): LabKitBody {
  const own = createOwned()
  const b: Build = { mats: ctx.materials, own }

  // 作る順は前の JSX のまま（置き場所の群の中: ドック・光のにじみ・電源のケーブル）
  const dockGroup = dock(b, opts?.label ?? DOCK_LABEL)
  // パッドの上のほのかな浮遊フィールド
  const sprite = glowSprite({ position: [0, KB001_DOCK_TOP + 0.04, 0], size: 0.5, color: PALETTE.cyan, opacity: 0.3 })
  own.mesh(sprite.inner.children[0] as THREE.Mesh)
  // ドックの電源ケーブル（東の壁のコンセントへ。ローカル -z の側。ワールドの東）。素材は共有なので形だけ控える
  const power = cable({ points: floorPath(0.018, [0, -0.44], [-0.2, -0.9], [-0.5, -1.4], [-0.68, -1.72]), radius: 0.018, material: ctx.materials.rubber })
  own.add(power.geometry)
  const object = group([dockGroup, sprite.object, power], { p: at.position, ry: at.rotationY })

  return {
    object,
    update(_dt, f) {
      sprite.update(f.camera)
    },
    dispose() {
      own.dispose()
    },
  }
}

export const dockKit: LabKitDef<DockOptions> = {
  kind: 'dock',
  plan: dockPlan,
  create: createDock,
}
