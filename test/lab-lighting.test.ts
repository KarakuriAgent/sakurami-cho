/**
 * ラボの照明と空気の three の形（world/lab/lighting/*・atmosphere.ts、明るさの入力 sakurami-cho/world/labLight.ts の labLighting。
 * docs/design/map-split.md §6 の 4-3）の見張り:
 *   - 光の表の並びが前の Lighting.tsx と同じ（31 個のうち、配信の立ち位置の 3 個は差し込み口 stage の位置に入る）。場面の木の光の順も同じ
 *   - 置き場所の印: 表から外した置き場所の光・光る板・光の筋は作らない
 *   - 反射用の環境の光る板の数と、全部が原点を向くこと（drei の Lightformer の癖のまま）
 *   - 明るさの入力: level はそのまま残り、明滅は照明の側で重なる。環境の強さは付けている間だけ照明が書く
 *   - 窓際の補助光の位置の元（WINDOW_STOP）が地図の立ち寄り先の表 TOWN_PLACES.window と同じ（5-1b。kanon-lab の立ち寄り先 STOPS.window とも同じことは、
 *     kanon-lab の server/test/lab-lighting.test.ts が見る。8-4 で分けた）
 * 地図のコードは DOM の型を使うので、lab-plan.test.ts と同じく実行の時に読む（kanon-lab の server/test にあった時に、server の tsconfig の型の確かめに入れなかった形。型は使う所だけ）
 */
import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'

const LAB = '../world/lab'
const LAB_CORE = '../core/lab'
const load = async <T>(path: string): Promise<T> => (await import(path)) as T

type V3 = [number, number, number]
interface LightSpec {
  kind: 'hemi' | 'core' | 'point' | 'spot' | 'area' | 'slot'
  kit?: string
}
interface TableMod {
  LAB_LIGHTS: readonly LightSpec[]
  LAB_FORMERS: readonly { kit?: string }[]
  WINDOW_STOP: V3
  LAB_ENV_INTENSITY: number
}
interface Placement {
  id: string
}
interface PlacementsMod {
  LAB_PLACEMENTS: readonly Placement[]
}
interface SlotContent {
  object: THREE.Object3D
  update?(dt: number, f: unknown): void
}
interface Lighting {
  object: THREE.Group
  environment: THREE.Texture
  slots: { stage: { object: THREE.Group } }
  bindChannels(source: { baseStation?: Partial<{ link: number; flash: number; pulse: number }> | null }): void
  attach(): () => void
  update(dt: number, f: { time: number }): void
  dispose(): void
}
interface LightingMod {
  createLabLighting(o: {
    renderer: unknown
    scene: THREE.Scene
    quality: 'high' | 'low'
    placements?: readonly Placement[]
    channels?: { baseStation?: Partial<{ link: number; flash: number; pulse: number }> }
    stage?: SlotContent | null
  }): Lighting
}
interface EnvMod {
  createLabEnvironment(o: { kits: ReadonlySet<string> }): { scene: THREE.Scene; dispose(): void }
}
interface AtmosphereMod {
  createLabAtmosphere(o: { quality: 'high' | 'low'; pixelRatio: number; placements?: readonly Placement[] }): { object: THREE.Group; attach(): () => void; dispose(): void }
}
interface LabLightMod {
  labLight: { value: number; level: number }
  labLighting: { set(i: { level: number; flash?: number; strobe?: number }): void }
}
interface TownHostMod {
  configureTown(o: { clock?: { sceneTime?: () => number } }): void
}

/** CubeCamera.update が使う所だけの、何も描かない renderer の代わり */
function fakeRenderer() {
  let target: unknown = null
  return {
    isWebGLRenderer: true,
    autoClear: false,
    coordinateSystem: THREE.WebGLCoordinateSystem,
    reversedDepthBuffer: false,
    xr: { enabled: false },
    state: { buffers: { depth: { getReversed: () => false } } },
    renders: 0,
    getRenderTarget: () => target,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    setRenderTarget(t: unknown) {
      target = t
    },
    clearDepth() {},
    render() {
      this.renders++
    },
  }
}

/** 場面の木の順の光（type） */
function lightTypes(o: THREE.Object3D) {
  const out: string[] = []
  o.traverse((x) => {
    if ((x as THREE.Light).isLight) out.push(x.type)
  })
  return out
}

/** 前の Lighting.tsx の光の並び（場面の木の順。stage = キー・フィル・リム） */
const OLD_ORDER = [
  'HemisphereLight',
  'PointLight',
  'PointLight',
  'PointLight',
  'SpotLight', // キー
  'PointLight', // フィル
  'SpotLight', // リム
  'PointLight',
  'SpotLight',
  'PointLight',
  'SpotLight',
  'SpotLight',
  'SpotLight',
  'SpotLight',
  'SpotLight',
  'SpotLight',
  'PointLight',
  'SpotLight',
  'SpotLight',
  'SpotLight',
  'SpotLight',
  'PointLight',
  'SpotLight',
  'SpotLight',
  'RectAreaLight',
  'PointLight',
  'SpotLight',
  'SpotLight',
  'RectAreaLight',
  'SpotLight',
  'PointLight',
]

/** 使う側の差し込み口の中身の代わり（キー・フィル・リムと同じ種類の光） */
function fakeStage(): SlotContent & { updates: number } {
  const object = new THREE.Group()
  const key = new THREE.SpotLight()
  const rim = new THREE.SpotLight()
  object.add(key, key.target, new THREE.PointLight(), rim, rim.target)
  const c = {
    object,
    updates: 0,
    update() {
      c.updates++
    },
  }
  return c
}

describe('ラボの照明と空気（4-3）', () => {
  test('光の表: 前の並びのまま 28 個と差し込み口 stage（基地局の光のあと）', async () => {
    const T = await load<TableMod>(`${LAB}/lighting/lightTable.ts`)
    expect(T.LAB_LIGHTS.length).toBe(29)
    expect(T.LAB_LIGHTS.findIndex((l) => l.kind === 'slot')).toBe(4)
    expect(T.LAB_LIGHTS.filter((l) => l.kind === 'core').length).toBe(1)
    // 印は置き場所の表の id だけ
    const P = await load<PlacementsMod>(`${LAB_CORE}/placements.ts`)
    const ids = new Set(P.LAB_PLACEMENTS.map((p) => p.id))
    for (const l of [...T.LAB_LIGHTS, ...T.LAB_FORMERS]) if ('kit' in l && l.kit) expect(ids.has(l.kit)).toBe(true)
    expect(T.LAB_ENV_INTENSITY).toBe(0.85)
  })

  test('照明を作ると、場面の木の光の順が前の Lighting.tsx と同じ（stage の中身は並びの位置に入り、毎コマ呼ばれる）', async () => {
    const M = await load<LightingMod>(`${LAB}/lighting/createLabLighting.ts`)
    const stage = fakeStage()
    const lighting = M.createLabLighting({ renderer: fakeRenderer(), scene: new THREE.Scene(), quality: 'high', stage })
    expect(lightTypes(lighting.object)).toEqual(OLD_ORDER)
    // spot の target は光と同じ親（場面の木にある）
    lighting.object.traverse((o) => {
      if ((o as THREE.SpotLight).isSpotLight) expect((o as THREE.SpotLight).target.parent).toBe(o.parent)
    })
    // 影を落とすのは作業台の手元灯（と stage のキー。ここでは代わりの物なので落とさない）。low なら落とさない
    expect(countShadows(lighting.object)).toBe(1)
    expect(countShadows(M.createLabLighting({ renderer: fakeRenderer(), scene: new THREE.Scene(), quality: 'low' }).object)).toBe(0)
    lighting.update(1 / 30, { time: 1 })
    expect(stage.updates).toBe(1)
  })

  test('置き場所の印: 表から基地局を外すと、コア・基地局の光・リングとコアの光る板が無くなる（ほかは同じ並び）', async () => {
    const M = await load<LightingMod>(`${LAB}/lighting/createLabLighting.ts`)
    const E = await load<EnvMod>(`${LAB}/lighting/environment.ts`)
    const P = await load<PlacementsMod>(`${LAB_CORE}/placements.ts`)
    const without = P.LAB_PLACEMENTS.filter((p) => p.id !== 'baseStation')
    const all = lightTypes(M.createLabLighting({ renderer: fakeRenderer(), scene: new THREE.Scene(), quality: 'high' }).object)
    const less = lightTypes(M.createLabLighting({ renderer: fakeRenderer(), scene: new THREE.Scene(), quality: 'high', placements: without }).object)
    expect(all.length - less.length).toBe(5)
    const formers = (kits: Set<string>) => {
      let n = 0
      E.createLabEnvironment({ kits }).scene.traverse((o) => (n += (o as THREE.Mesh).isMesh ? 1 : 0))
      return n
    }
    expect(formers(new Set(P.LAB_PLACEMENTS.map((p) => p.id)))).toBe(29)
    expect(formers(new Set(without.map((p) => p.id)))).toBe(27)
    const A = await load<AtmosphereMod>(`${LAB}/atmosphere.ts`)
    const shafts = (placements?: readonly Placement[]) => A.createLabAtmosphere({ quality: 'low', pixelRatio: 1, placements }).object.children.length
    expect(shafts()).toBe(4)
    expect(shafts(P.LAB_PLACEMENTS.filter((p) => p.id !== 'gallery'))).toBe(3)
  })

  test('反射用の環境の光る板は全部が原点を向く（drei の Lightformer の癖のまま。+z が原点の方）', async () => {
    const E = await load<EnvMod>(`${LAB}/lighting/environment.ts`)
    const P = await load<PlacementsMod>(`${LAB_CORE}/placements.ts`)
    const env = E.createLabEnvironment({ kits: new Set(P.LAB_PLACEMENTS.map((p) => p.id)) })
    env.scene.updateMatrixWorld(true)
    env.scene.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return
      const p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld)
      const z = new THREE.Vector3(0, 0, 1).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()))
      expect(z.dot(p.clone().negate().normalize())).toBeCloseTo(1, 9)
    })
    expect(env.scene.background).toBeInstanceOf(THREE.Color)
  })

  test('明るさの入力: level はそのまま残り、明滅（strobe）は照明の側で重なる。環境の強さは付けている間だけ書く', async () => {
    const H = await load<TownHostMod>('../world/townHost.ts')
    const L = await load<LabLightMod>('../world/labLight.ts')
    const M = await load<LightingMod>(`${LAB}/lighting/createLabLighting.ts`)
    let t = 0
    H.configureTown({ clock: { sceneTime: () => t } })
    L.labLighting.set({ level: 0.32 })
    expect([L.labLight.level, L.labLight.value]).toEqual([0.32, 0.32])
    // 明滅: sin(38t) + 0.6 sin(23.7t) > 0.2 なら点いている（1.25 へ）、そうでなければ消えている（0.04 へ）
    t = 0.05
    const on = Math.sin(t * 38) + Math.sin(t * 23.7) * 0.6 > 0.2
    L.labLighting.set({ level: 0.32, strobe: 1 })
    expect(L.labLight.level).toBe(0.32)
    expect(L.labLight.value).toBe(0.32 + ((on ? 1.25 : 0.04) - 0.32) * 1)
    const scene = new THREE.Scene()
    const renderer = fakeRenderer()
    const lighting = M.createLabLighting({ renderer, scene, quality: 'low' })
    const detach = lighting.attach()
    expect(scene.environment).toBe(lighting.environment)
    expect(renderer.renders).toBe(6)
    L.labLighting.set({ level: 0.5 })
    expect(scene.environmentIntensity).toBe(0.85 * (0.4 + 0.6 * Math.min(1.2, 0.5)))
    detach()
    L.labLighting.set({ level: 1 })
    expect(scene.environment).toBe(null)
    expect(scene.environmentIntensity).toBe(1)
  })

  test('照明のコアは基地局の入力の値（getter）を読むたびに見る。bindChannels で結び付け直せる', async () => {
    const M = await load<LightingMod>(`${LAB}/lighting/createLabLighting.ts`)
    const fx = { link: 0 }
    const lighting = M.createLabLighting({
      renderer: fakeRenderer(),
      scene: new THREE.Scene(),
      quality: 'low',
      channels: {
        baseStation: {
          get link() {
            return fx.link
          },
        },
      },
    })
    const core = lighting.object.children[1] as THREE.PointLight
    const base = (t: number) => 8 + Math.sin(t * 1.3) * 1.2 + Math.sin(t * 7.1) * 0.25
    lighting.update(0, { time: 2 })
    expect(core.intensity).toBe(base(2) * (1 + 0 * 0.35 + 0 * 2.5 + 0 * 1.8))
    fx.link = 1
    lighting.update(0, { time: 2 })
    expect(core.intensity).toBe(base(2) * (1 + 1 * 0.35 + 0 * 2.5 + 0 * 1.8))
    // あとから結び付け直せる（createLab は基地局のキットの channels に。4-6）。null で既定の値（0）に
    const kit = { link: 0, flash: 1, pulse: 0.5 }
    lighting.bindChannels({ baseStation: kit })
    lighting.update(0, { time: 2 })
    expect(core.intensity).toBe(base(2) * (1 + 1 * 2.5 + 0.5 * 1.8))
    lighting.bindChannels({ baseStation: null })
    lighting.update(0, { time: 2 })
    expect(core.intensity).toBe(base(2))
  })

  test('窓際の補助光の位置の元は、地図の立ち寄り先の表 TOWN_PLACES.window と同じ（写した配列）', async () => {
    const T = await load<TableMod>(`${LAB}/lighting/lightTable.ts`)
    const places = await load<{ TOWN_PLACES: { window: { position: V3 } } }>('../core/places.ts')
    expect(T.WINDOW_STOP).toEqual([-0.5, 0, 4.6])
    expect(T.WINDOW_STOP).toEqual([...places.TOWN_PLACES.window.position])
    expect(T.WINDOW_STOP).not.toBe(places.TOWN_PLACES.window.position)
  })
})

function countShadows(o: THREE.Object3D) {
  let n = 0
  o.traverse((x) => {
    if ((x as THREE.Light).isLight && x.castShadow) n++
  })
  return n
}
