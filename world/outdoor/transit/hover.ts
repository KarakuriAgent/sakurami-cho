import * as THREE from 'three'
import { HOVER_DOCKS, HOVER_DOCK_IDS } from '../../../core/hoverDocks'
import { townWalk } from '../../walk/townWalk'
import { OUTDOOR_LAYER } from '../layers'
import { localShadowCasters } from '../town/shadows'
import { createHoverMaterial, hoverGeometry, padGeometry } from './hoverCar'
import { hoverCraft, padTop } from './hoverCraft'

/**
 * 花音のホバーの一人乗りと乗り場の台を描く（町の交通の一部。transit.ts が作って毎コマ update）。docs/design/town.md §21。
 * ホバーの行列・ファンの回り・灯りは機体（transit/hoverCraft.ts の hoverCraft。乗る仕組みが毎コマ書く）を読む。台は町の地面を読めるようになったら 1 回だけ作る
 */
export class HoverView {
  readonly group = new THREE.Group()
  private readonly body: THREE.Mesh
  private readonly mat: THREE.ShaderMaterial
  private readonly padMat: THREE.ShaderMaterial
  private padsBuilt = false
  private spin = 0
  private readonly cam = new THREE.Vector3()
  private readonly pos = new THREE.Vector3()

  constructor() {
    this.group.name = 'hover'
    this.mat = createHoverMaterial()
    this.padMat = createHoverMaterial()
    this.body = new THREE.Mesh(hoverGeometry(), this.mat)
    this.body.name = 'hover:body'
    this.body.matrixAutoUpdate = false
    this.body.visible = false
    this.body.layers.set(OUTDOOR_LAYER)
    this.body.renderOrder = 11
    this.group.add(this.body)
    // 花音のまわりの細かい影の地図に入れる（台・地面・レーンの下に影が落ちる）
    localShadowCasters.add(this.body)
  }

  private buildPads() {
    for (const id of HOVER_DOCK_IDS) {
      const d = HOVER_DOCKS[id]
      const top = padTop(d)
      let low = top
      for (let a = 0; a < 8; a++) low = Math.min(low, townWalk.groundY(d.pad[0] + Math.cos(a) * 1.2, d.pad[1] + Math.sin(a) * 1.2, undefined, false))
      const mesh = new THREE.Mesh(padGeometry(!!d.private, Math.max(0.06, top - low + 0.08)), this.padMat)
      mesh.name = `hover:pad:${id}`
      mesh.position.set(d.pad[0], top - 0.0125, d.pad[1])
      mesh.rotation.y = d.heading
      mesh.layers.set(OUTDOOR_LAYER)
      mesh.renderOrder = 11
      this.group.add(mesh)
    }
    this.padsBuilt = true
  }

  update(camera: THREE.Camera, dt: number, night: number) {
    if (!this.padsBuilt && townWalk.ready) this.buildPads()
    if (!hoverCraft.ready) {
      this.body.visible = false
      return
    }
    camera.getWorldPosition(this.cam)
    this.pos.setFromMatrixPosition(hoverCraft.matrix)
    this.body.visible = this.pos.distanceTo(this.cam) < 700
    this.body.matrix.copy(hoverCraft.matrix)
    this.body.matrixWorldNeedsUpdate = true
    // 羽根の回り（回っている間は速く。模様が流れて見えすぎないよう、上限を決める）
    this.spin = (this.spin + dt * hoverCraft.power * 31) % (Math.PI * 200)
    const u = this.mat.uniforms
    u.uPower.value = hoverCraft.power
    u.uLamp.value = hoverCraft.lamp
    u.uSpin.value = this.spin
    // 台の充電の柱の灯り（夜に小さく。ホバーを置いているかに関わらず）
    this.padMat.uniforms.uPower.value = 0.6
    this.padMat.uniforms.uLamp.value = night
  }
}
