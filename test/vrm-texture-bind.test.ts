/**
 * 表情の UV のずらし（texture transform bind）が WebGPU の MToonNodeMaterial でも効く（character/avatar/loadVrm.ts の enableNodeTextureTransformBind。
 * WebGPU への移行の第 2 段）。lookAt が expression の方式の VRM（kanon.vrm）は、虹彩・ハイライトの map の offset・repeat を動かして視線を作る。
 * 描いた見た目（MToonNodeMaterial が texture.matrix を UV に掛ける）は撮影で確かめる（配信の avatar-glance など）
 */
import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'

describe('表情の UV のずらし（MToonNodeMaterial）', () => {
  test('足す前は「not supported」で何もしない。足すと map を複製して offset・repeat を重みで動かし、clear で戻す', async () => {
    const { VRMExpressionTextureTransformBind } = await import('@pixiv/three-vrm')
    const { MToonNodeMaterial } = await import('@pixiv/three-vrm/nodes')
    const { enableNodeTextureTransformBind } = await import('../character/avatar/loadVrm.ts')
    const map = new THREE.Texture()
    const make = () => {
      const m = new MToonNodeMaterial()
      m.name = 'Iris'
      m.map = map
      return m
    }
    const offset = new THREE.Vector2(0.1, -0.05)
    const scale = new THREE.Vector2(1, 1)

    const table = (VRMExpressionTextureTransformBind as unknown as { _propertyNamesMap: Record<string, string[]> })._propertyNamesMap
    const had = table.isMToonNodeMaterial
    delete table.isMToonNodeMaterial
    const warn = console.warn
    const warned: string[] = []
    console.warn = (...a: unknown[]) => void warned.push(String(a[0]))
    try {
      const before = make()
      new VRMExpressionTextureTransformBind({ material: before, offset, scale }).applyWeight(1)
      expect(warned.some((w) => w.includes('not supported'))).toBe(true)
      expect(before.map).toBe(map)

      warned.length = 0
      enableNodeTextureTransformBind()
      enableNodeTextureTransformBind()
      expect(table.isMToonNodeMaterial).toEqual(table.isMToonMaterial)
      const m = make()
      const bind = new VRMExpressionTextureTransformBind({ material: m, offset, scale })
      expect(warned).toEqual([])
      // 材質ごとに複製したテクスチャを動かす（元のテクスチャは動かさない）
      expect(m.map).not.toBe(map)
      bind.applyWeight(0.5)
      expect(m.map!.offset.x).toBeCloseTo(0.05, 12)
      expect(m.map!.offset.y).toBeCloseTo(-0.025, 12)
      expect(map.offset.x).toBe(0)
      bind.clearAppliedWeight()
      expect(m.map!.offset.toArray()).toEqual([0, 0])
    } finally {
      console.warn = warn
      if (had) table.isMToonNodeMaterial = had
    }
  })
})
