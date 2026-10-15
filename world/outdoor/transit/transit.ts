import * as THREE from 'three/webgpu'
import { townOptions } from '../../townHost'
import { outdoor } from '../../environment/daylight'
import type { TownInfra, TownTile } from '../town/townData'
import { createNamedSignMaterial } from '../named/namedMaterial'
import { signAtlas } from '../named/signs'
import { createSiteGlassMaterial } from '../site/siteMaterial'
import type { Lamp } from '../town/lamps'
import type { LightItem } from '../town/lights'
import { BoatFleet, boatNet } from './boats'
import { boatLandings } from './landings'
import { WaterbusDetail } from './waterbusCar'
import { StationRobots } from './robots'
import { CABLE_CAR, CableLine, cableTrack } from './cable'
import { transitClock } from './clock'
import { LaneFleet } from './lanes'
import { HoverView } from './hover'
import { TramFleet, tramNet } from './trams'
import { TramDetail } from './tramCar'
import { TrainFleet } from './trains'
import { buildTransitInfraSteps, railBallast, transitLights, type InfraContext } from './transitInfra'
import { createTransitMaterial, createWireMaterial, transitUniforms } from './transitMaterial'
import { vehicleShapes } from './vehicles'
import { OUTDOOR_LAYER } from '../layers'
import { depthMaterial } from '../town/shadows'

/**
 * 町の交通（緑電・ヒノテツ・丘ノ上ケーブル・運河バス・連絡船・港の小舟・浮遊レーンの浮遊機）と、その動かない物（線路・架線・停留所・信号・街灯の柱）。
 * 動く物は交通の時計（clock.ts）だけから位置を決めるので、撮影では毎回同じ画になる。設計は docs/design/town.md の §15。
 */

/**
 * ケーブルカーの形に作り込む勾配（段々の床）。線路の多くの所（7〜14%）と 3 駅（5〜14%）で床がほぼ水平になる 0.12（§7 の 177。前は 0.2）。
 * 頂上の手前の 32% の 40m だけ、車体が前へ 11° ほど傾く
 */
const CABLE_BUILT_SLOPE = CABLE_CAR.slope

export interface Transit {
  group: THREE.Group
  /** 町の灯りの点・灯りの表に足す物（停留所・レーン灯） */
  lights: LightItem[]
  lamps: Lamp[]
  /** 毎コマ（px = 画面の高さの半分 / tan(画角の半分)。細い線の太さ） */
  update(camera: THREE.Camera, dt: number, px: number, shown?: boolean): void
  /** 細かさの中心が動いた（近くの動かない物を作り直す） */
  relod(center: [number, number]): void
  /** relod を手順に分けたもの（1 つ進むごとに yield。最後に差し替える） */
  relodSteps(center: [number, number]): Generator<void>
  stats(): { vehicles: number; infraTris: number }
}

export function createTransit(infra: TownInfra, tiles: TownTile[], skipLight: InfraContext['skipLight'], radius: number): Transit | null {
  const t = infra.transit
  if (!t) return null
  const group = new THREE.Group()
  group.name = 'transit'
  const material = createTransitMaterial()
  const shapes = vehicleShapes(CABLE_BUILT_SLOPE)
  // 系統の色
  const lc = transitUniforms.uLineColors.array as THREE.Color[]
  for (const l of t.trams) lc[l.no]?.set(l.color)
  lc[5].set('#d9692a')
  lc[6].set('#26a69a')
  lc[7].set('#c4402c')

  // 系統の運転・停留所のホーム（歩ける面とまわりの地形の均し）は、地形の格子を作る前に作ってある（landscape.ts の setupTramNet）
  const trams = tramNet.lines
  const tramFleet = new TramFleet(trams, shapes, material, new TramDetail(3))
  // 乗る仕組み（character/ride/tramRide.ts）・カメラ・音が使う
  tramNet.fleet = tramFleet
  const trainFleet = t.rail ? new TrainFleet(t.rail, shapes, material) : null
  const cable = infra.cable ? new CableLine(infra.cable, shapes, material, CABLE_BUILT_SLOPE) : null
  cableTrack.line = cable
  const boats = new BoatFleet(t, shapes, material, new WaterbusDetail(3), boatLandings.list)
  boatNet.fleet = boats
  const lanes = new LaneFleet(t, shapes, material)
  // 花音のホバーの一人乗り（hover.ts）
  const hover = new HoverView()
  group.add(hover.group)
  // 駅員ロボ「えきもり」（ケーブルの 3 駅・緑電の主な停留所・運河バスの乗り場。robots.ts）
  const robots = new StationRobots(boatLandings.list)
  robots.group.layers.set(OUTDOOR_LAYER)
  for (const m of robots.group.children) m.layers.set(OUTDOOR_LAYER)
  group.add(robots.group)
  const moving: THREE.Object3D[] = [...tramFleet.meshes, ...(trainFleet?.meshes ?? []), ...(cable?.meshes ?? []), ...boats.meshes, ...lanes.meshes]
  for (const m of moving) {
    m.layers.set(OUTDOOR_LAYER)
    // 透ける物（細かいケーブルカーのガラス）は後から
    m.renderOrder = Math.max(m.renderOrder, 11)
    group.add(m)
  }

  const ctx: InfraContext = { trams, trains: trainFleet, cable, transit: t, tiles, skipLight, landings: boatLandings.list }
  const extra = transitLights(ctx)
  // ヒノテツの道床（町じゅう）
  if (trainFleet) {
    const ballast = new THREE.Mesh(railBallast(trainFleet).build(), material)
    ballast.name = 'transit:ballast'
    ballast.frustumCulled = false
    ballast.layers.set(OUTDOOR_LAYER)
    ballast.renderOrder = 11
    group.add(ballast)
  }
  // 近くの動かない物（作り直す）
  const wireMat = createWireMaterial('#2a2c2e')
  const plainDepth = depthMaterial()
  const signMat = createNamedSignMaterial(signAtlas.tex)
  const glassMat = createSiteGlassMaterial()
  let near: THREE.Object3D[] = []
  let infraTris = 0
  const relod = (center: [number, number]) => {
    for (const step of relodSteps(center)) void step
  }
  function* relodSteps(center: [number, number]): Generator<void> {
    const built = yield* buildTransitInfraSteps(ctx, center, radius)
    for (const o of near) {
      group.remove(o)
      ;(o as THREE.Mesh).geometry.dispose()
    }
    const solid = new THREE.Mesh(built.geometry, material)
    solid.name = 'transit:infra'
    solid.frustumCulled = false
    // 架線柱・停留所・街灯の柱・信号は町の太陽の影を落とす（動かないので、細かさの中心が動いたときに描き直す影の地図に入れる）
    solid.userData.shadowMaterial = plainDepth
    const wires = new THREE.Mesh(built.wires, wireMat)
    wires.name = 'transit:wires'
    wires.frustumCulled = false
    wires.renderOrder = 5
    const signs = new THREE.Mesh(built.signs, signMat)
    signs.name = 'transit:signs'
    signs.frustumCulled = false
    const glass = new THREE.Mesh(built.glass, glassMat)
    glass.name = 'transit:glass'
    glass.frustumCulled = false
    near = [solid, wires, signs, glass]
    for (const o of near) {
      o.layers.set(OUTDOOR_LAYER)
      o.renderOrder = o === wires || o === glass ? 14 : 11
      group.add(o)
    }
    infraTris = (built.geometry.index?.count ?? 0) / 3
  }
  relod([0, 0])

  const _cam = new THREE.Vector3()
  /** 駅員ロボの動きの時計（描画の時計。撮影では 1 コマずつ決まった秒） */
  let animTime = 0
  // ?debug: コンソールから車両の位置を見る（__transit.trams.positions など）
  if (townOptions().debug) (window as unknown as { __transit: unknown }).__transit = { group, trams: tramFleet, trains: trainFleet, cable, boats, lanes, robots, hover, clock: transitClock }
  return {
    group,
    lights: [...extra.lights, ...lanes.lights],
    lamps: extra.lamps,
    update(camera, dt, px, shown = true) {
      // 交通の時計は町の毎コマの初め（town.begin。world/createTown.ts）が先に進める（観覧車のゴンドラと花音の位置を同じコマにそろえる）
      animTime += Math.min(Math.max(dt, 0), 0.25)
      // ケーブルの 2 両の位置と扉は、描かないコマも決める（乗っている花音・カメラが使う）
      if (!shown) {
        cable?.updateState(transitClock.serviceSec)
        tramFleet.updateState(transitClock.serviceSec, null)
        boats.updateState(transitClock.serviceSec, transitClock.sec, null)
        return
      }
      const tt = transitClock.serviceSec
      const o = outdoor
      transitUniforms.uLampOn.value = Math.max(o.lights.street, 0.15 * (1 - o.daylight))
      transitUniforms.uLightGain.value = o.lightGain
      transitUniforms.uSignalT.value = transitClock.sec % 80
      const lit = 1
      camera.getWorldPosition(_cam)
      tramFleet.update(tt, camera, lit, 1 - THREE.MathUtils.smoothstep(o.daylight, 0.1, 0.45))
      trainFleet?.update(tt, camera, lit)
      cable?.update(tt, camera, o.cableRunning > 0.5 ? 1 : 0.3, 1 - THREE.MathUtils.smoothstep(o.daylight, 0.1, 0.45))
      boats.update(tt, transitClock.sec, camera, lit, 1 - THREE.MathUtils.smoothstep(o.daylight, 0.1, 0.45))
      lanes.update(transitClock.sec, camera)
      hover.update(camera, Math.min(Math.max(dt, 0), 0.25))
      robots.update(camera, tt, animTime)
      wireMat.uniforms.uPx.value = px
    },
    relod,
    relodSteps,
    stats() {
      const v = moving.reduce((s, m) => s + ((m as THREE.InstancedMesh).count ?? 0), 0)
      return { vehicles: v, infraTris }
    },
  }
}
