import * as THREE from 'three'
import { PALETTE } from '../../palette'
import { glowMaterial, perforatedMaterial } from '../../materials/labMaterials'
import { createOwned, type LabKitBody, type LabKitContext, type LabKitDef } from '../kit'
import { cable } from '../parts/cable'
import { boxInstances, matrixInstances, sticker, type InstanceItem } from '../parts/details'
import { group } from '../parts/object'
import type { Placement } from '../../../core/lab/plan'
import { serverRackPlan } from '../../../core/lab/kits/serverRack.plan'

/**
 * サーバラック 3 本（北の壁沿い、基地局の東。その東が資料庫の扉。設定資料（vol6 12-2・D-052）の「からくりラック 2 本＋図面棚サーバー 1」。
 * からくりワールドもここで動いている。資料の範囲 x 3.4〜6.4・壁から 0.1〜0.9m）。
 * 点滅する LED は InstancedMesh + instanceColor でまとめて描く（毎コマの更新で、毎秒 20 回色を変える）。
 * ローカル座標: 原点 = 北の壁の面・床・3 本の中央、+Z が部屋の内側。
 *
 * 前の zones/ServerRack.tsx を、同じ入れ子・同じ子の順・同じ作る順（hooks の素材 → JSX の子の順。子を作ってから群）で three の形にした物
 * （docs/design/map-split.md §6 の「段 4」・4-5）。障害物はデータの側（serverRack.plan.ts）
 */

const RACK_W = 0.62
const RACK_H = 2.05
const RACK_D = 0.8
const U = 0.0445
/** 下の台（黒い金属）の高さ */
const PLINTH_H = 0.08
/**
 * 前の柱（レール）の下端の高さ。下の台の上の面から立てる。4-0b で決めた。仮: もとはレールの下端が 0.05 で台の中に入り、
 * レールの前の面と台の前の面が同じ所で重なって、作る順（material.id）でどちらが見えるかが決まっていた。今の見え方（台の前の面が見える）にそろえる
 */
const RAIL_Y0 = PLINTH_H
/** レールの上端の高さ */
const RAIL_Y1 = RACK_H - 0.05
/**
 * レールの前の面を側板の前の面より奥へ下げる量（1mm）。4-0b で決めた。仮: もとはレールの前の面が側板の前の面と同じ面にあって縁で接し、
 * 縁の画素が作る順（material.id）でどちらになるかが決まっていた（床の映り込みのぼかしで、光の点のように広がって見える）。側板の前の面が前に出る形にそろえる
 */
const RAIL_INSET = 0.001
/** 西から からくりラック 2 本・図面棚サーバー */
const RACK_XS = [-0.95, -0.15, 0.95]

/** ラックに積むサーバ（U 数の並び） */
const STACK = [2, 1, 1, 2, 1, 1, 1, 4, 2, 1, 1, 2, 1, 1, 3, 2, 1, 1, 2, 1, 1, 1, 2, 1, 1]

const LED_COLORS = [new THREE.Color(PALETTE.cyan), new THREE.Color(PALETTE.blue), new THREE.Color('#eaf6ff')]

export function createServerRack(at: Placement, _opts: object | undefined, ctx: LabKitContext): LabKitBody {
  const mats = ctx.materials
  const own = createOwned()
  const ventMat = own.add(perforatedMaterial(mats, 10, 1.2))
  for (const t of [ventMat.alphaMap, ventMat.normalMap]) if (t) own.add(t)
  const z0 = 0.1
  const front = z0 + RACK_D

  const servers: THREE.Matrix4[] = []
  const leds: THREE.Matrix4[] = []
  const vents: THREE.Matrix4[] = []
  RACK_XS.forEach((rx, ri) => {
    let y = 0.12
    STACK.forEach((u, si) => {
      const h = u * U
      if (y + h > RACK_H - 0.12) return
      // ところどころ空きスロット（ブランクパネル）を作る
      const blank = (si + ri) % 9 === 4
      servers.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(rx, y + h / 2, front - 0.03 - (blank ? 0 : 0.0)),
          new THREE.Quaternion(),
          new THREE.Vector3(RACK_W - 0.08, h - 0.004, 0.04),
        ),
      )
      if (!blank) {
        const n = 3 + ((si * 7 + ri) % 4)
        for (let k = 0; k < n; k++) {
          leds.push(new THREE.Matrix4().makeTranslation(rx - RACK_W / 2 + 0.07 + k * 0.018, y + h / 2 + (u > 1 ? h * 0.25 : 0), front - 0.008))
        }
        vents.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(rx + 0.08, y + h / 2, front - 0.0085),
            new THREE.Quaternion(),
            new THREE.Vector3(0.3, Math.max(h - 0.018, 0.012), 1),
          ),
        )
      }
      y += h + 0.002
    })
  })

  const ledState = leds.map((_, i) => ({ color: LED_COLORS[i % 7 === 0 ? 2 : i % 3 === 0 ? 1 : 0], rate: 0.5 + ((i * 37) % 11) / 3, phase: i * 1.7 }))
  const ledMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false })
  const ledGeom = new THREE.BoxGeometry(0.006, 0.006, 0.004)
  const serverGeom = own.add(new THREE.BoxGeometry(1, 1, 1))
  const ventGeom = own.add(new THREE.PlaneGeometry(1, 1))
  const tmp = new THREE.Color()

  const topGlow = glowMaterial(PALETTE.blue, 2.6)

  // 筐体・レール・発光バーは、3 本ぶんをそれぞれ 1 回で描く
  const black: InstanceItem[] = []
  const rails: InstanceItem[] = []
  const glow: InstanceItem[] = []
  for (const rx of RACK_XS) {
    // 天板・底板・側板・背板
    black.push({ p: [rx, RACK_H - 0.02, z0 + RACK_D / 2], s: [RACK_W, 0.04, RACK_D] })
    black.push({ p: [rx, PLINTH_H / 2, z0 + RACK_D / 2], s: [RACK_W, PLINTH_H, RACK_D] })
    for (const s of [-1, 1]) black.push({ p: [rx + s * (RACK_W / 2 - 0.01), RACK_H / 2, z0 + RACK_D / 2], s: [0.02, RACK_H, RACK_D] })
    black.push({ p: [rx, RACK_H / 2, z0 + 0.01], s: [RACK_W, RACK_H, 0.02] })
    // 前面のフレーム（19 インチのレール）と上部の発光バー
    for (const s of [-1, 1]) rails.push({ p: [rx + s * (RACK_W / 2 - 0.035), (RAIL_Y0 + RAIL_Y1) / 2, front - 0.01 - RAIL_INSET], s: [0.03, RAIL_Y1 - RAIL_Y0, 0.02] })
    glow.push({ p: [rx, RACK_H - 0.06, front - 0.004], s: [RACK_W - 0.1, 0.008, 0.004] })
  }
  // ラックの上の配線は、北の壁の配線ダクト（中二階の床の下）へ入る
  black.push({ p: [0, RACK_H + 0.26, z0 + 0.09], s: [RACK_XS[RACK_XS.length - 1] - RACK_XS[0] + RACK_W, 0.16, 0.18] })

  // 子の順と作る順は前の JSX のまま（筐体・レール・発光バー・サーバ・通気口・LED・ステッカー 2 枚・配線 3 本）
  const children: THREE.Object3D[] = []
  children.push(own.add(boxInstances({ items: black, material: mats.blackMetal, castShadow: true })))
  children.push(own.add(boxInstances({ items: rails, material: mats.darkMetal })))
  children.push(own.add(boxInstances({ items: glow, material: topGlow, receiveShadow: false })))
  children.push(own.add(matrixInstances({ matrices: servers, geometry: serverGeom, material: mats.darkMetal })))
  children.push(own.add(matrixInstances({ matrices: vents, geometry: ventGeom, material: ventMat, receiveShadow: false })))
  const ledMesh = own.mesh(new THREE.InstancedMesh(ledGeom, ledMat, leds.length))
  children.push(ledMesh)
  children.push(
    own.mesh(
      sticker({
        text: 'KARAKURI WORLD',
        sub: 'KARAKURI RACK A / B',
        position: [(RACK_XS[0] + RACK_XS[1]) / 2, RACK_H - 0.18, front + 0.002],
        width: 0.5,
        aspect: 5,
        background: 'transparent',
        color: '#9fb4c8',
      }),
    ),
  )
  children.push(
    own.mesh(
      sticker({
        text: 'PLAN CHEST',
        sub: '図面棚サーバー',
        position: [RACK_XS[2], RACK_H - 0.18, front + 0.002],
        width: 0.5,
        aspect: 5,
        background: 'transparent',
        color: '#9fb4c8',
        font: 'jp',
      }),
    ),
  )
  // ラックの上から北の壁の配線ダクトへ上がる配線（素材は共有の物なので、控えるのは形だけ）
  for (const rx of RACK_XS) {
    const c = cable({
      points: [
        [rx - 0.1, RACK_H, z0 + 0.36],
        [rx - 0.1, RACK_H + 0.1, z0 + 0.32],
        [rx - 0.06, RACK_H + 0.18, z0 + 0.12],
      ],
      radius: 0.018,
      material: mats.rubber,
    })
    own.add(c.geometry)
    children.push(c)
  }

  // LED の行列と色（前の useLayoutEffect）
  leds.forEach((m, i) => {
    ledMesh.setMatrixAt(i, m)
    ledMesh.setColorAt(i, ledState[i].color)
  })
  ledMesh.instanceMatrix.needsUpdate = true
  if (ledMesh.instanceColor) ledMesh.instanceColor.needsUpdate = true
  ledMesh.computeBoundingSphere()

  const object = group(children, { p: at.position, ry: at.rotationY })

  let acc = 0
  return {
    object,
    update(dt, f) {
      // 点滅（アクセスランプらしく不規則に）。毎秒 20 回
      acc += dt
      if (acc < 1 / 20) return
      acc = 0
      const t = f.time
      ledState.forEach((s, i) => {
        const v = Math.sin(t * s.rate * 6 + s.phase) + Math.sin(t * s.rate * 2.3 + s.phase * 3)
        const on = v > 0.2 ? 3.2 : v > -0.6 ? 0.9 : 0.15
        tmp.copy(s.color).multiplyScalar(on)
        ledMesh.setColorAt(i, tmp)
      })
      if (ledMesh.instanceColor) ledMesh.instanceColor.needsUpdate = true
    },
    dispose: () => own.dispose(),
  }
}

export const serverRackKit: LabKitDef = {
  kind: 'serverRack',
  plan: serverRackPlan,
  create: createServerRack,
}
