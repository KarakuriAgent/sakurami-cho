import * as THREE from 'three'
import { mulberry32 } from '../../core/random'
import { addLabLightDimmer } from '../labLight'
import { DustMaterial, LightShaftMaterial } from '../materials/effects'
import { LAB_SPOTS, zp } from './lighting/lightTable'
import { LAB_PLACEMENTS, type LabPlacement } from '../../core/lab/placements'
import { PLACE, ROOM, type Vec3 } from '../../core/lab/plan'

/**
 * 空気感（docs/design/map-split.md §6 の「段 4」・4-3。案の §3.1）: 薄い霧（場面の fogExp2。使う側）＋ 光の筋 ＋ 空中を舞うほこり。
 * 前の Atmosphere.tsx と同じ値の入れ方。毎コマの更新は無い（動きはシェーダーの共有の時計 sharedTime）。
 * 配信の立ち位置のキーとリムの光の筋は、使う側の照明の差し込み口の中身（kanon-lab の scene/stream/stageLights.ts。lightShaft で作る）。
 */

export interface LightShaftOptions {
  /** 光源（円錐の頂点側）の位置 */
  from: Vec3 | readonly [number, number, number]
  /** 光が当たる先（円錐の底の中心） */
  to: Vec3 | readonly [number, number, number]
  /** 底の半径 */
  radius: number
  /** 光源側の半径（既定 0.08） */
  topRadius?: number
  color?: THREE.ColorRepresentation
  /** 既定 0.1 */
  intensity?: number
}

export interface LightShaft {
  mesh: THREE.Mesh<THREE.CylinderGeometry, LightShaftMaterial>
  /** 明るさの割合（部屋の照明と一緒に薄くするとき addLabLightDimmer に渡す） */
  setLevel(k: number): void
  dispose(): void
}

/** ボリュメトリック風の光の筋（開いた円錐を加算合成で描く。renderOrder 5） */
export function lightShaft(o: LightShaftOptions): LightShaft {
  const { topRadius = 0.08, color = '#9fd8ff', intensity = 0.1 } = o
  const a = new THREE.Vector3(...o.from)
  const b = new THREE.Vector3(...o.to)
  const dir = new THREE.Vector3().subVectors(a, b)
  const length = dir.length()
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
  const position = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5)
  const geometry = new THREE.CylinderGeometry(topRadius, o.radius, length, 40, 1, true)
  const material = new LightShaftMaterial()
  material.color.set(color)
  material.intensity = intensity
  material.falloff = 1.4
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.copy(position)
  mesh.quaternion.copy(quaternion)
  mesh.renderOrder = 5
  return {
    mesh,
    setLevel(k) {
      material.intensity = intensity * k
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}

interface ShaftSpec extends LightShaftOptions {
  /** この置き場所が表に無ければ作らない */
  kit?: string
  /** 天井の照明の筋なら、部屋の照明と一緒に薄くする（最小 0.15） */
  roomLight?: boolean
}

const holo = PLACE.holoTable.position
const S = LAB_SPOTS

/** 光の筋（天井のスポット lab/lighting/lightTable.ts に合わせる。前の Atmosphere.tsx のホロ・作業台・ギャラリーの 3 本） */
export const LAB_SHAFTS: readonly ShaftSpec[] = [
  { kit: 'holoTable', from: S.holo, to: [holo[0], 0, holo[2]], radius: 1.0, color: '#bfe0ff', intensity: 0.04, roomLight: true },
  { kit: 'workshop', from: S.bench.from, to: zp(PLACE.workshop, [0.4, 0, 0.7]), radius: 1.4, color: '#e8f0ff', intensity: 0.04, roomLight: true },
  { kit: 'gallery', from: S.gallery.from, to: zp(PLACE.gallery, [0, 0, 0.9]), radius: 1.3, color: '#e8f0ff', intensity: 0.035, roomLight: true },
]

/** 空中を舞うほこり（renderOrder 6。カリングしない） */
function dust(count: number, pixelRatio: number) {
  const geometry = new THREE.BufferGeometry()
  const pos = new Float32Array(count * 3)
  const seed = new Float32Array(count)
  const rnd = mulberry32(2350)
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (rnd() - 0.5) * ROOM.width * 0.95
    pos[i * 3 + 1] = rnd() * ROOM.height * 0.9
    pos[i * 3 + 2] = ROOM.centerZ + (rnd() - 0.5) * ROOM.depth * 0.95
    seed[i] = rnd()
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
  // 粒は部屋全体に散らばるのでカリングしない
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 20)
  const material = new DustMaterial()
  material.uniforms.uPixelRatio.value = pixelRatio
  material.uniforms.uOpacity.value = 0.22
  ;(material.uniforms.uBoundsMin.value as THREE.Vector3).fromArray([-ROOM.halfWidth, 0, ROOM.north])
  ;(material.uniforms.uBoundsMax.value as THREE.Vector3).fromArray([ROOM.halfWidth, ROOM.height, ROOM.south])
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  points.renderOrder = 6
  return points
}

export interface LabAtmosphere {
  readonly object: THREE.Group
  /** 明るさの入力に付ける（付けている間だけ、天井の照明の筋が部屋の照明と一緒に薄くなる）。外す関数を返す */
  attach(): () => void
  /** 画面の画素の比（ほこりの粒の大きさ） */
  setPixelRatio(dpr: number): void
  dispose(): void
}

/** 空気感を作る。quality が high ならほこりを多く（天井が高くなったぶん、5m → 6.5m で同じ密度に） */
export function createLabAtmosphere(o: { quality: 'high' | 'low'; pixelRatio: number; placements?: readonly LabPlacement[] }): LabAtmosphere {
  const kits = new Set((o.placements ?? LAB_PLACEMENTS).map((p) => p.id))
  const object = new THREE.Group()
  object.name = 'lab:atmosphere'
  const shafts: { shaft: LightShaft; roomLight: boolean }[] = []
  for (const spec of LAB_SHAFTS) {
    if (spec.kit && !kits.has(spec.kit)) continue
    const shaft = lightShaft(spec)
    shafts.push({ shaft, roomLight: !!spec.roomLight })
    object.add(shaft.mesh)
  }
  const points = dust(o.quality === 'high' ? 3400 : 1300, o.pixelRatio)
  object.add(points)
  return {
    object,
    attach() {
      const offs = shafts.filter((s) => s.roomLight).map(({ shaft }) => addLabLightDimmer((k) => shaft.setLevel(k), 0.15))
      return () => offs.forEach((off) => off())
    },
    setPixelRatio(dpr) {
      ;(points.material as DustMaterial).uniforms.uPixelRatio.value = dpr
    },
    dispose() {
      for (const { shaft } of shafts) shaft.dispose()
      points.geometry.dispose()
      ;(points.material as DustMaterial).dispose()
    },
  }
}
