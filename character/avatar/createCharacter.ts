import * as THREE from 'three'
import { townPlaces, type PlaceId, type TownPlace } from '../../core/places'
import { zoneAt } from '../../core/interiors'
import { mulberry32 } from '../../core/random'
import { createRider } from '../ride/rider'
import { createRides } from '../ride/rides'
import { createMemberRide, Party } from '../ride/party'
import { site } from '../../world/outdoor/site/siteModel'
import { createBodyMetrics } from './body'
import { Character, type CharacterAnchors, type CharacterKind, type CharacterMotion } from './character'
import { createFloatState } from './float'
import { createVrmRim } from './loadVrm'
import { createTravelRun } from './travel'
import { VISUAL_DEFAULTS, type VrmMtoonConfig } from './visualConfig'

/** VRM を読むまでの体の目安の身長（m。anchorGuess を省いたとき。kanon-lab の花音の GUIDE_HEIGHT と同じ値） */
const DEFAULT_HEIGHT = 1.65

/** 立ち寄り先でない所から始めるときの位置（歩く人は足元、浮かんで動く物は本体の中心。ワールド座標）と向き（省けば 0 = +Z 向き） */
export interface CharacterSpawnPoint {
  position: readonly [number, number, number]
  heading?: number
}

export interface CharacterOptions {
  /** 見分ける名前（'kanon' など） */
  id: string
  /** 種類（省けば walker。float は character/avatar/float.ts の状態を持つ） */
  kind?: CharacterKind
  /** 最初にいる所: 立ち寄り先（configurePlaces で渡した表 townPlaces() の名前。その位置・向き・行動・椅子のまま置く。台 lift のある所は天面に）か、位置と向き */
  spawn: PlaceId | CharacterSpawnPoint
  /** 乱数の種（null なら Math.random。撮影で毎回同じ動きにするときに決める。作るときには引かない） */
  seed: number | null
  /**
   * VRM を読むまでの体の位置（anchors）の目安: 足元の位置と身長（頭は身長 − 0.12m、胸は − 0.4m）。
   * 省けば最初の足元の位置と身長 1.65m
   */
  anchorGuess?: { position: readonly [number, number, number]; height: number }
  /** 縁の光（rim）の MToon の調整（省けば character/avatar/visualConfig.ts の既定値。見た目（character/avatar/characterVisual.ts）の mtoon の既定もこれ） */
  mtoon?: VrmMtoonConfig
}

/** キャラクターを作る（character/avatar/character.ts）。外から動かすもの（drivers）は使う側が付ける（kanon-lab は src/kanon/index.ts） */
export function createCharacter(o: CharacterOptions): Character {
  const kind = o.kind ?? 'walker'
  const spawn = o.spawn
  let start: TownPlace | null = null
  let position: THREE.Vector3
  let heading: number
  if (typeof spawn === 'string') {
    start = townPlaces()[spawn]
    const ground = site.groundY(start.position[0], start.position[2])
    position = new THREE.Vector3(start.position[0], start.lift ? ground + start.lift.top : ground, start.position[2])
    heading = start.heading
  } else {
    position = new THREE.Vector3(spawn.position[0], spawn.position[1], spawn.position[2])
    heading = spawn.heading ?? 0
  }
  const motion: CharacterMotion = {
    position,
    ground: 0,
    outside: false,
    heading,
    speed: 0,
    turnRate: 0,
    gait: 0,
    walk: 0,
    phase: 'idle',
    stopId: typeof spawn === 'string' ? spawn : null,
    targetId: null,
    action: start?.action ?? null,
    actionBlend: start ? 1 : 0,
    moveDir: new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading)),
    arrivedAt: 0,
    activityHeld: false,
    zone: zoneAt(position.x, position.z),
    level: start?.level ?? 0,
    indoor: false,
    seat: start?.seat ?? null,
    placeSerial: 0,
    timeScale: 1,
    stride: null,
  }
  const [gx, gy, gz] = o.anchorGuess?.position ?? motion.position.toArray()
  const gh = o.anchorGuess?.height ?? DEFAULT_HEIGHT
  const anchors: CharacterAnchors = {
    ready: false,
    head: new THREE.Vector3(gx, gy + gh - 0.12, gz),
    chest: new THREE.Vector3(gx, gy + gh - 0.4, gz),
    measuredHeight: 0,
  }
  return new Character({
    id: o.id,
    kind,
    float: kind === 'float' ? createFloatState(position, heading) : null,
    motion,
    anchors,
    body: createBodyMetrics(),
    rim: createVrmRim(o.mtoon ?? VISUAL_DEFAULTS.mtoon),
    rnd: o.seed !== null ? mulberry32(o.seed) : Math.random,
    travel: createTravelRun(),
    ride: createRider(new Party(), createMemberRide()),
    rides: createRides,
  })
}
