/**
 * 描く回数を減らす仕組み（WebGPU への移行の第 3 段）の見張り:
 *   - world/staticMerge.ts の mergeStatic: 動かない mesh を素材・影の設定・レイヤー・頂点の並びごとに合わせ、いちばん近い体（根・動く物・bodies）の
 *     子にする。合わせた形の頂点は元の物と同じ世界の位置。動く物・透明・名前のある物・差し込み口の中・裏返しの行列は合わせない。InstancedMesh は
 *     count の数だけ写す。freeze で動かない物の行列を固める
 *   - world/instancing.ts の instancedMesh: 入れ物は 1,025 以上、count は描く数
 *   - world/lab/labCull.ts: カメラが箱の中なら描く・視野の外なら描かない・遮蔽が 3 回続いたら描かない・カメラが跳んだら描く
 */
import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'

const load = async <T>(path: string): Promise<T> => (await import(path)) as T
const MAP = new URL('..', import.meta.url).pathname

interface MergeMod {
  markDynamic<T extends THREE.Object3D>(...o: T[]): T | undefined
  isDynamic(o: THREE.Object3D): boolean
  mergeStatic(
    root: THREE.Object3D,
    o?: { bodies?: Iterable<THREE.Object3D>; skip?: (o: THREE.Object3D) => boolean; freeze?: boolean },
  ): { sources: number; merged: number; dispose(): void }
}
interface InstMod {
  INSTANCE_CAPACITY_MIN: number
  instancedMesh(g: THREE.BufferGeometry, m: THREE.Material, count: number): THREE.InstancedMesh
}
interface CullMod {
  createLabCull(): {
    proxy: THREE.Mesh
    readonly visible: boolean
    setTargets(t: THREE.Object3D[]): void
    setBounds(b: THREE.Box3): void
    update(camera: THREE.Camera): void
    dispose(): void
  }
}

/** mesh の頂点を世界の座標で（index の順に三角形ごと） */
function worldTriangles(root: THREE.Object3D): number[][] {
  root.updateMatrixWorld(true)
  const out: number[][] = []
  const v = new THREE.Vector3()
  const m = new THREE.Matrix4()
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !mesh.visible) return
    const g = mesh.geometry
    const idx = g.index
    const n = idx ? idx.count : g.attributes.position!.count
    const inst = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh) : null
    for (let k = 0; k < (inst ? inst.count : 1); k++) {
      if (inst) inst.getMatrixAt(k, m)
      else m.identity()
      for (let i = 0; i < n; i += 3) {
        const tri: number[] = []
        for (let j = 0; j < 3; j++) {
          v.fromBufferAttribute(g.attributes.position as THREE.BufferAttribute, idx ? idx.getX(i + j) : i + j)
          v.applyMatrix4(m).applyMatrix4(mesh.matrixWorld)
          tri.push(...v.toArray().map((x) => Math.round(x * 1e4) / 1e4))
        }
        out.push(tri)
      }
    }
  })
  return out.map((t) => t.join(',')).sort().map((s) => s.split(',').map(Number))
}

describe('mergeStatic', () => {
  test('同じ素材の動かない物は 1 つになり、頂点の世界の位置は変わらない。動く物の下はその物の子として合わせる', async () => {
    const { mergeStatic, markDynamic } = await load<MergeMod>(`${MAP}world/staticMerge.ts`)
    const mat = new THREE.MeshStandardMaterial()
    const other = new THREE.MeshStandardMaterial()
    const root = new THREE.Group()
    root.position.set(1, 2, 3)
    const g = new THREE.Group()
    g.position.set(0.5, 0, 0)
    g.rotation.y = 0.4
    root.add(g)
    const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat)
    a.position.set(0, 1, 0)
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 4), mat)
    b.scale.set(1, 2, 1)
    g.add(a, b)
    const c = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), other)
    root.add(c)
    const arm = new THREE.Group()
    arm.position.set(0, 0, 1)
    markDynamic(arm)
    root.add(arm)
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), mat)
    const e = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), mat)
    e.position.x = 0.3
    arm.add(d, e)
    const before = worldTriangles(root)
    const r = mergeStatic(root)
    expect([r.sources, r.merged]).toEqual([4, 2])
    expect(a.parent).toBeNull()
    expect(b.parent).toBeNull()
    expect(c.parent).toBe(root)
    expect(d.parent).toBeNull()
    // 動く物の子として合わせる（動く物が回ると一緒に回る）
    const underArm = arm.children.filter((o) => (o as THREE.Mesh).isMesh)
    expect(underArm.length).toBe(1)
    expect((underArm[0] as THREE.Mesh).material).toBe(mat)
    expect(worldTriangles(root)).toEqual(before)
    // 固める: 動かない物は matrixAutoUpdate = false、動く物はそのまま
    expect(g.matrixAutoUpdate).toBe(false)
    expect(root.matrixAutoUpdate).toBe(false)
    expect(arm.matrixAutoUpdate).toBe(true)
    r.dispose()
  })

  test('合わせない物: 透明・名前のある物・差し込み口の中・裏返し・見えない物・1 つしか無い物', async () => {
    const { mergeStatic } = await load<MergeMod>(`${MAP}world/staticMerge.ts`)
    const mat = new THREE.MeshStandardMaterial()
    const glass = new THREE.MeshStandardMaterial({ transparent: true })
    const root = new THREE.Group()
    const box = () => new THREE.BoxGeometry(1, 1, 1)
    const t1 = new THREE.Mesh(box(), glass)
    const t2 = new THREE.Mesh(box(), glass)
    const named = new THREE.Mesh(box(), mat)
    named.name = 'core'
    const slot = new THREE.Group()
    slot.name = 'slot:x'
    const s1 = new THREE.Mesh(box(), mat)
    const s2 = new THREE.Mesh(box(), mat)
    slot.add(s1, s2)
    const mirrored = new THREE.Mesh(box(), mat)
    mirrored.scale.x = -1
    const hidden = new THREE.Group()
    hidden.visible = false
    hidden.add(new THREE.Mesh(box(), mat), new THREE.Mesh(box(), mat))
    const lone = new THREE.Mesh(box(), mat)
    root.add(t1, t2, named, slot, mirrored, hidden, lone)
    const r = mergeStatic(root, { skip: (o) => o.name.startsWith('slot:') })
    expect([r.sources, r.merged]).toEqual([0, 0])
    for (const o of [t1, t2, named, s1, s2, mirrored, lone]) expect(o.parent).not.toBeNull()
    // 差し込み口の中は固めない
    expect(slot.matrixAutoUpdate).toBe(true)
    expect(s1.matrixAutoUpdate).toBe(true)
  })

  test('InstancedMesh は count の数だけ写す（入れ物の残りは写さない）。色を持つ物は合わせない。bodies の群の下はその群の子にする', async () => {
    const { mergeStatic } = await load<MergeMod>(`${MAP}world/staticMerge.ts`)
    const { instancedMesh, INSTANCE_CAPACITY_MIN } = await load<InstMod>(`${MAP}world/instancing.ts`)
    const mat = new THREE.MeshStandardMaterial()
    const root = new THREE.Group()
    const casters = new THREE.Group()
    casters.position.y = 2
    root.add(casters)
    const im = instancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, 3)
    expect(im.instanceMatrix.count).toBe(INSTANCE_CAPACITY_MIN)
    expect(im.count).toBe(3)
    for (let i = 0; i < 3; i++) im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i, 0, 0))
    const plain = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat)
    casters.add(im, plain)
    const colored = instancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, 2)
    colored.setColorAt(0, new THREE.Color('red'))
    const colored2 = instancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, 2)
    colored2.setColorAt(0, new THREE.Color('blue'))
    casters.add(colored, colored2)
    const before = worldTriangles(casters)
    const r = mergeStatic(root, { bodies: [casters] })
    expect([r.sources, r.merged]).toEqual([2, 1])
    const merged = casters.children.find((o) => o.name.startsWith('static:')) as THREE.Mesh
    expect(merged).toBeDefined()
    expect(merged.geometry.index!.count).toBe(4 * 36)
    expect(colored.parent).toBe(casters)
    expect(worldTriangles(casters)).toEqual(before)
  })
})

describe('labCull', () => {
  const camera = () => {
    const c = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 40000)
    c.updateProjectionMatrix()
    return c
  }
  const box = new THREE.Box3(new THREE.Vector3(-8, 0, -5), new THREE.Vector3(8, 7, 5))

  test('箱の中は描く。視野の外は描かない。遮蔽が 3 回続いたら描かない。カメラが跳んだら描く', async () => {
    const { createLabCull } = await load<CullMod>(`${MAP}world/lab/labCull.ts`)
    const cull = createLabCull()
    const target = new THREE.Group()
    cull.setTargets([target])
    cull.setBounds(box)
    const cam = camera()
    // 箱の中
    cam.position.set(0, 2, 0)
    cull.update(cam)
    expect(cull.visible).toBe(true)
    // 箱の外で、箱を見ていない（後ろを向く）
    cam.position.set(0, 2, 200)
    cam.lookAt(0, 2, 400)
    cull.update(cam)
    expect(cull.visible).toBe(true) // 跳んだコマは描く
    cull.update(cam)
    expect(cull.visible).toBe(false)
    expect(target.visible).toBe(false)
    // 箱を見る。遮蔽の結果が来るまでは描く
    cam.lookAt(0, 2, 0)
    cull.update(cam)
    expect(cull.visible).toBe(true)
    const renderer = { occluded: true, isOccluded: () => renderer.occluded }
    const frame = () => {
      cull.proxy.onBeforeRender(renderer as never, new THREE.Scene(), cam, cull.proxy.geometry, cull.proxy.material as THREE.Material, new THREE.Group())
      cull.update(cam)
    }
    // 視野に入ったコマの直後の 2 回は前の結果として捨てる。そのあと 3 回続けて陰なら隠す
    for (let i = 0; i < 4; i++) frame()
    expect(cull.visible).toBe(true)
    frame()
    expect(cull.visible).toBe(false)
    // 1 回でも見えたら描く
    renderer.occluded = false
    frame()
    expect(cull.visible).toBe(true)
    // 箱は 3m と距離の 3° の大きい方だけ広げる
    const d = box.distanceToPoint(cam.position)
    expect(cull.proxy.scale.x).toBeCloseTo(16 + 2 * Math.max(3, d * Math.tan(THREE.MathUtils.degToRad(3))), 6)
    cull.dispose()
  })
})
