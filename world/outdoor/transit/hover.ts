import * as THREE from 'three'
import { OUTDOOR_LAYER } from '../layers'
import { localShadowCasters } from '../town/shadows'
import { createHoverMaterial, hoverGeometry } from './hoverCar'
import { hoverCraft } from './hoverCraft'

/**
 * 花音のホバーの一人乗りを描く（町の交通の一部。transit.ts が作って毎コマ update）。docs/design/town.md §21。
 * ホバーの行列・ファンの回り・灯りは機体（transit/hoverCraft.ts の hoverCraft。乗る仕組みが毎コマ書く）を読む。乗り場の台は無い（#9。呼ぶと来る）。
 * まだ一度も呼んでいない間（hoverCraft.ready = false）は描かない
 */
export class HoverView {
  readonly group = new THREE.Group()
  private readonly body: THREE.Mesh
  private readonly mat: THREE.ShaderMaterial
  private spin = 0
  private readonly cam = new THREE.Vector3()
  private readonly pos = new THREE.Vector3()

  constructor() {
    this.group.name = 'hover'
    this.mat = createHoverMaterial()
    this.body = new THREE.Mesh(hoverGeometry(), this.mat)
    this.body.name = 'hover:body'
    this.body.matrixAutoUpdate = false
    this.body.visible = false
    this.body.layers.set(OUTDOOR_LAYER)
    this.body.renderOrder = 11
    this.group.add(this.body)
    // 花音のまわりの細かい影の地図に入れる（地面・道の上に影が落ちる）
    localShadowCasters.add(this.body)
  }

  update(camera: THREE.Camera, dt: number) {
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
  }
}
