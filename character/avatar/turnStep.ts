/**
 * その場で向きを変えるときの足踏み（着いて向きを合わせる turnEnd・歩き出す前に行き先の方へ向く turnStart・見る先へ体ごと向き直る faceToward。
 * 町の中の移動（kanon.travel）の歩き出す前と着いた後も同じ）。
 *
 * 前は体全体を回しながら歩きの動きを 3 割・ゆっくり流すだけで、足を床に置いていなかったので、回る間ずっと足が床の上を滑って見えた。
 * ここでは回る角度を 1 歩ずつに分け、1 歩ごとに「軸足を床に置いたまま、もう片方の足を持ち上げて回る先へ置く」。体はその足が宙にある間に回る
 * （回る速さを足踏みに合わせる）。足ごとに「床に置いた向き」を持ち、見た目（character/avatar/turnStepPose.ts）が、床に着いている足をその向きの所に
 * 留め、持ち上げた足を前の所から次の所へ運ぶ（脚の IK。character/avatar/limbIk.ts）。
 *
 * - 1 歩: 回る側の足（左へ回るなら左足）から。続けて回るときは、遅れている方の足を出す（交互になる）。1 歩で回る角度は、床に残る足が体の向きから
 *   STEP_LAG_MAX より遅れない・持ち上げた足が STEP_SWING_MAX より大きく回らない分まで
 * - 回り終えて、遅れたままの足が STEP_CLOSE より遅れていれば、その足をそろえる 1 歩（体は回らない）を足す。それより小さければ、そのまま
 *   （少し開いた足で立つ）。小さい角度（STEP_CLOSE より小さい）は 1 歩、90° ほどは 2 歩、180° ほどは 4 歩
 * - 歩幅に満たない小さなずれ（min より小さい）は、exact なら足を上げずに少しずつ回す（着いた所の向きにぴったり合わせる）
 * - 1 歩の長さは、足を回す角度から（STEP_BASE_SEC + STEP_SEC_PER_RAD × 角度）。slow（見る先へ向き直る）なら少しゆっくり。早送り（timeScale）ではその倍で
 *
 * 状態は CharacterMotion の step（character/avatar/character.ts）。歩き出す・乗る・座る・跳ぶ・置き直すと releaseTurnStep で外す（足はアニメーションのまま）。
 * three を読まない（Hub の確かめ・テストからも使える）
 */

/** 足（L = 本人の左） */
export type StepFoot = 'L' | 'R'

/** その場で向きを変える足踏みの状態（CharacterMotion の step） */
export interface TurnStep {
  /** 使っているか（止まって立っている間。歩き出す・乗る・座る・跳ぶ・置き直すと外れる） */
  active: boolean
  /** 足ごとの、床に置いた向き（体の向きと同じなら、その足は今の姿勢のまま） */
  yawL: number
  yawR: number
  /** 今持ち上げている足（null = 両足とも床） */
  foot: StepFoot | null
  /** 歩の進み（0〜1）と長さ（秒） */
  u: number
  dur: number
  /** 歩の始めと終わりの体の向き、持ち上げた足の始めの向き */
  from: number
  to: number
  footFrom: number
  /** 前に動かした足 */
  last: StepFoot | null
  /** 足を置いた歩の数（数えるだけ。確かめ用） */
  count: number
}

/**
 * 1 歩のあと、床に残った足（の位置）が体の向きから遅れてよい最大（rad）。床に残った足は、つま先を軸にかかとを回すように向きを半分だけ体へ寄せる
 * （見た目の turnStepPose.ts。位置は動かさない）ので、股関節のひねりはこの半分ほど
 */
export const STEP_LAG_MAX = 1.6
/** 持ち上げた足が 1 歩で回る最大（rad） */
export const STEP_SWING_MAX = 2.1
/** 回り終えて、これより遅れている足はそろえる（rad） */
export const STEP_CLOSE = 0.42
/** 1 歩の長さ（秒）: STEP_BASE_SEC + STEP_SEC_PER_RAD × 足を回す角度 */
const STEP_BASE_SEC = 0.3
const STEP_SEC_PER_RAD = 0.13
/** 見る先へ向き直る（slow）ときの 1 歩の長さの倍率 */
const SLOW = 1.3
/** 足を上げずに回す速さ（rad/s。歩幅に満たない小さなずれ） */
const PIVOT_RATE = 0.7

export function createTurnStep(): TurnStep {
  return { active: false, yawL: 0, yawR: 0, foot: null, u: 0, dur: 0.4, from: 0, to: 0, footFrom: 0, last: null, count: 0 }
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/** 0〜1 のなめらかな段 */
function smooth(u: number) {
  const x = Math.min(1, Math.max(0, u))
  return x * x * (3 - 2 * x)
}

/** 歩の進み u での体の回り（0〜1）。足が床を離れてから回り始め、着く少し前に回り終える */
export function stepBodyEase(u: number) {
  return smooth((u - 0.08) / 0.8)
}

/** 歩の進み u での持ち上げた足の回り（0〜1）。体より少し先に着く */
export function stepFootEase(u: number) {
  return smooth((u - 0.04) / 0.8)
}

/** 歩の進み u での足の持ち上げ（0〜1。着いたら 0） */
export function stepLiftEase(u: number) {
  const x = Math.min(1, Math.max(0, u / 0.86))
  return Math.sin(Math.PI * x)
}

/** 持ち上げた足と床にある足の、今の向き（体の向きは m の heading。足ごとに、床に置いた向き・宙にある足は前の所から次の所への途中） */
export function footYaw(s: TurnStep, foot: StepFoot) {
  if (s.foot === foot) return wrap(s.footFrom + wrap(s.to - s.footFrom) * stepFootEase(s.u))
  return foot === 'L' ? s.yawL : s.yawR
}

/** 外す（足はアニメーションのまま）。歩き出す・乗る・座る・跳ぶ・置き直すとき */
export function releaseTurnStep(s: TurnStep) {
  s.active = false
  s.foot = null
  s.last = null
}

/** stepTurn の決まり */
export interface StepTurnOptions {
  /** 1 歩を始めるずれの最小（rad。これより小さいずれは歩かない） */
  min?: number
  /** 見る先へ向き直る（1 歩をゆっくり） */
  slow?: boolean
  /** 歩幅に満たない小さなずれも、足を上げずに少しずつ回してぴったり合わせる（着いた所の向き） */
  exact?: boolean
  /** 回り終えたら、遅れた足をそろえる（STEP_CLOSE より遅れていれば） */
  close?: boolean
}

/** 動きの、向き・向きを変える速さ・時間の倍率（CharacterMotion の一部） */
export interface StepTurnMotion {
  heading: number
  turnRate: number
  timeScale: number
  step: TurnStep
}

/**
 * 体の向き（m.heading）を target へ、足踏みで回す（毎コマ呼ぶ）。m.turnRate も書く。回し残し（target − 向き）を返す。
 * 歩の途中は、その歩の終わりの向きへ向かう（途中で target が変わっても、その歩は終える）
 */
export function stepTurn(m: StepTurnMotion, target: number, dt: number, opts: StepTurnOptions = {}): number {
  const s = m.step
  const min = opts.min ?? 0.08
  if (!s.active) {
    s.active = true
    s.yawL = s.yawR = m.heading
    s.foot = null
    s.last = null
  }
  const prev = m.heading
  const ts = Math.max(0, dt) * (m.timeScale || 1)
  if (s.foot) {
    s.u = Math.min(1, s.u + ts / s.dur)
    m.heading = wrap(s.from + wrap(s.to - s.from) * stepBodyEase(s.u))
    if (s.u >= 1) {
      m.heading = s.to
      if (s.foot === 'L') s.yawL = s.to
      else s.yawR = s.to
      s.last = s.foot
      s.foot = null
    }
  }
  if (!s.foot) {
    const err = wrap(target - m.heading)
    if (Math.abs(err) > min) startRotate(s, m.heading, err, min, !!opts.slow)
    else if (opts.exact && Math.abs(err) > 1e-4) {
      const k = Math.min(Math.abs(err), PIVOT_RATE * ts)
      m.heading = wrap(m.heading + Math.sign(err) * k)
    } else if (opts.close) {
      const lagL = Math.abs(wrap(s.yawL - m.heading))
      const lagR = Math.abs(wrap(s.yawR - m.heading))
      const foot: StepFoot = lagL >= lagR ? 'L' : 'R'
      if (Math.max(lagL, lagR) > STEP_CLOSE) startStep(s, foot, m.heading, m.heading, !!opts.slow)
    }
  }
  m.turnRate = dt > 0 ? wrap(m.heading - prev) / dt : 0
  return wrap(target - m.heading)
}

/** 歩いているか（足を持ち上げている）、そろえる歩が残っているか（回り終えて、STEP_CLOSE より遅れた足がある） */
export function turnStepBusy(s: TurnStep, heading: number) {
  if (!s.active) return false
  if (s.foot) return true
  return Math.abs(wrap(s.yawL - heading)) > STEP_CLOSE || Math.abs(wrap(s.yawR - heading)) > STEP_CLOSE
}

function yawOf(s: TurnStep, f: StepFoot) {
  return f === 'L' ? s.yawL : s.yawR
}

/** 回る歩を始める（err = 回し残し。+ = 左へ） */
function startRotate(s: TurnStep, heading: number, err: number, min: number, slow: boolean) {
  const dir = Math.sign(err)
  const lead: StepFoot = dir > 0 ? 'L' : 'R'
  const other: StepFoot = lead === 'L' ? 'R' : 'L'
  // 回る向きに見た足の位置（+ = 体より先、− = 遅れている）。遅れている方の足を出す（同じなら回る側の足）
  const ahead = (f: StepFoot) => wrap(yawOf(s, f) - heading) * dir
  let foot = ahead(other) < ahead(lead) - 0.05 ? other : lead
  let stay = foot === lead ? other : lead
  let a = Math.min(Math.abs(err), STEP_LAG_MAX + ahead(stay), STEP_SWING_MAX + ahead(foot))
  if (a < 0.05) {
    // 床に残る足が遅れすぎていて回れない: その足を先に出す
    ;[foot, stay] = [stay, foot]
    a = Math.min(Math.abs(err), STEP_LAG_MAX + ahead(stay), STEP_SWING_MAX + ahead(foot))
    if (a < 0.05) a = 0
  }
  // 残りがわずかなら、この歩で回し切る（限りを少し超えてよい）
  if (Math.abs(err) - a < min * 1.5 && Math.abs(err) <= a + 0.2) a = Math.abs(err)
  startStep(s, foot, heading, heading + dir * a, slow)
}

function startStep(s: TurnStep, foot: StepFoot, from: number, to: number, slow: boolean) {
  s.foot = foot
  s.u = 0
  s.from = from
  s.to = wrap(to)
  s.footFrom = yawOf(s, foot)
  const swing = Math.abs(wrap(s.to - s.footFrom))
  s.dur = (STEP_BASE_SEC + STEP_SEC_PER_RAD * swing) * (slow ? SLOW : 1)
  s.count++
}
