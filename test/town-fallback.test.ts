/**
 * 町の地図データが無いとき（manifest.json が 404）の遠景（world/outdoor/landscape.ts の fallbackSite）の見張り:
 *   - ラボの外観とまわりのセットだけを作り、その太陽の影の地図（TownShadows）も作る。セットの材質は町の影を 3 枚読むので、影の uniform は
 *     比べの設定のある深さのテクスチャ（WebGPU への移行の第 1 段から TextureNode の value。前の WebGL では null だと GL_INVALID_OPERATION になった）
 *   - 影は町の地図データがあるときと同じ仕組み: 近く・遠くの影の地図にラボの外観とセットを深さだけのシェーダーで描き、花音のまわりの細かい影の
 *     地図にも描く。太陽が沈んでいれば影を使わない
 * 描くのは GPU を使わない renderer の代わり（WebGPURenderer の形。何を描き先にして、どの形をどの素材で描いたかだけを記録する）。地図のコードは DOM の型を使うので、
 * ほかのテストと同じく実行の時に読む。質感の画像は読まない（TextureLoader をこのテストの間だけ空のテクスチャを返す物にする）
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import * as THREE from 'three'

const load = async <T>(path: string): Promise<T> => (await import(path)) as T

interface Frame {
  time: number
  dt: number
  camera: THREE.Camera
  renderer: unknown
  scene: THREE.Scene
}
interface LandscapeMod {
  landscape(): { object: THREE.Group; start(): void; update(f: Frame): void; updateView(f: Frame): void }
}
interface ShadowUniforms {
  uShadowNear: { value: THREE.DepthTexture | null }
  uShadowFar: { value: THREE.DepthTexture | null }
  uShadowLocal: { value: THREE.DepthTexture | null }
  uShadowInfo: { value: THREE.Vector4 }
  uShadowLocalInfo: { value: THREE.Vector2 }
}
interface ShadowsMod {
  townShadowUniforms: ShadowUniforms
}
interface TownDataMod {
  townData: { status: string }
}
interface DaylightMod {
  outdoor: { sunDir: THREE.Vector3 }
}
interface TownHostMod {
  configureTown(o: { assetBase?: string }): void
  setTownFocus(f: { position: THREE.Vector3; outside: boolean; walking: boolean; moveDir: THREE.Vector3; ride: { car: null; inside: boolean; seat: { z: number; side: number } } }): void
}

/** 描いた物の記録: 描き先（影の地図の深さのテクスチャ）と、そのとき描いた形の名前と素材の名前 */
interface Draw {
  depth: THREE.DepthTexture | null
  meshes: string[]
}

type RenderObjectFn = (object: THREE.Object3D, scene: THREE.Object3D, camera: THREE.Camera, geometry: unknown, material: THREE.Material, group: null, ...rest: unknown[]) => void

/**
 * 影の地図を描くのに使う所だけの、GPU を使わない renderer の代わり（WebGPURenderer の形。WebGPU への移行の第 1 段から）。
 * render は見えている形ごとに描き物の関数（setRenderObjectFunction。無ければそのまま描く）を呼び、renderObject が描いた形と素材を記録する
 */
function fakeRenderer() {
  let target: THREE.RenderTarget | null = null
  let fn: RenderObjectFn | null = null
  const draws: Draw[] = []
  let current: Draw | null = null
  const r = {
    draws,
    autoClear: true,
    coordinateSystem: THREE.WebGPUCoordinateSystem,
    getMaxAnisotropy: () => 8,
    domElement: { height: 720 },
    getPixelRatio: () => 1,
    getRenderTarget: () => target,
    setRenderTarget(t: THREE.RenderTarget | null) {
      target = t
    },
    getRenderObjectFunction: () => fn,
    setRenderObjectFunction(f: RenderObjectFn | null) {
      fn = f
    },
    clear() {},
    renderObject(object: THREE.Object3D, _scene: unknown, _camera: unknown, _geometry: unknown, material: THREE.Material) {
      current?.meshes.push(`${object.name}:${material.name}`)
    },
    render(root: THREE.Object3D, camera: THREE.Camera) {
      current = { depth: (target?.depthTexture as THREE.DepthTexture | null) ?? null, meshes: [] }
      root.traverseVisible((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh || Array.isArray(mesh.material)) return
        if (fn) fn(o, root, camera, mesh.geometry, mesh.material, null)
        else r.renderObject(o, root, camera, mesh.geometry, mesh.material)
      })
      draws.push(current)
      current = null
    },
  }
  return r
}

const loaderLoad = THREE.TextureLoader.prototype.load
const fetchOrig = globalThis.fetch
const errorOrig = console.error

describe('町の地図データが無いときのラボの外観とセット', () => {
  let M: LandscapeMod
  let S: ShadowsMod
  let D: TownDataMod
  let L: DaylightMod
  beforeAll(async () => {
    THREE.TextureLoader.prototype.load = function () {
      return new THREE.Texture()
    }
    globalThis.fetch = (async () => new Response('not found', { status: 404 })) as unknown as typeof fetch
    console.error = () => undefined
    const H = await load<TownHostMod>('../world/townHost')
    H.configureTown({ assetBase: '/' })
    // 花音はラボの前（外）にいる（細かい影の地図の中心）
    H.setTownFocus({ position: new THREE.Vector3(-6.6, 0, 7.2), outside: true, walking: false, moveDir: new THREE.Vector3(0, 0, 1), ride: { car: null, inside: false, seat: { z: 0, side: 1 } } })
    M = await load<LandscapeMod>('../world/outdoor/landscape')
    S = await load<ShadowsMod>('../world/outdoor/town/shadows')
    D = await load<TownDataMod>('../world/outdoor/town/townData')
    L = await load<DaylightMod>('../world/environment/daylight')
  })
  afterAll(() => {
    THREE.TextureLoader.prototype.load = loaderLoad
    globalThis.fetch = fetchOrig
    console.error = errorOrig
  })

  test('影の地図を作り、ラボの外観とセットを町があるときと同じ仕組みで影の地図に描く。太陽が沈めば影を使わない', async () => {
    const view = M.landscape()
    view.start()
    for (let i = 0; i < 50 && D.townData.status !== 'missing'; i++) await new Promise((r) => setTimeout(r, 10))
    expect(D.townData.status).toBe('missing')

    const u = S.townShadowUniforms
    const renderer = fakeRenderer()
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 5000)
    camera.position.set(24, 16, 28)
    camera.lookAt(0, 0, 2)
    camera.updateMatrixWorld()
    const frame = (): Frame => ({ time: 0, dt: 1 / 30, camera, renderer, scene: new THREE.Scene() })
    // 午後の太陽（南西の高さ 35° ほど）
    L.outdoor.sunDir.set(-0.45, 0.57, 0.68).normalize()
    view.updateView(frame())
    view.update(frame())

    // 3 つの影の uniform は、比べの設定のある深さのテクスチャ
    for (const name of ['uShadowNear', 'uShadowFar', 'uShadowLocal'] as const) {
      const tex = u[name].value
      expect(tex?.isDepthTexture).toBe(true)
      expect(tex?.compareFunction).toBe(THREE.LessEqualCompare)
    }
    expect(u.uShadowInfo.value.z).toBe(1)
    expect(u.uShadowLocalInfo.value.y).toBe(1)

    // 近くの影の地図（1 コマ目）と細かい影の地図に、ラボの殻とセットが深さだけのシェーダーで入る
    const near = renderer.draws.find((d) => d.depth === u.uShadowNear.value)
    const local = renderer.draws.find((d) => d.depth === u.uShadowLocal.value)
    expect(near?.meshes).toEqual(expect.arrayContaining(['site:shell:townShadowDepth', 'site:grounds:townShadowDepth']))
    expect(local?.meshes).toEqual(expect.arrayContaining(['site:shell:townShadowDepth', 'site:grounds:townShadowDepth']))
    // 遠くの影の地図は次のコマで（1 コマに 1 枚まで。町があるときと同じ）
    view.update(frame())
    expect(renderer.draws.some((d) => d.depth === u.uShadowFar.value)).toBe(true)

    // 夜（太陽が沈んだ）: 影を使わない
    L.outdoor.sunDir.set(0, -0.3, 1).normalize()
    view.update(frame())
    expect(u.uShadowInfo.value.z).toBe(0)
    expect(u.uShadowLocalInfo.value.y).toBe(0)
  })
})
