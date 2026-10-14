/**
 * 交通と駅の音の素材（docs/design/film-mode.md §10・town.md §20）。どれも、ここで数式から作る（録った音・人の作った素材は使わない。権利の心配が無い）。
 * 同じ種（seed）から毎回同じ音になるので、配信（AudioContext）と撮影の書き出し（OfflineAudioContext。world/sound/townSound.ts）で同じ音が鳴る。
 *
 * - 一度だけ鳴る音（ONESHOTS）: ケーブルの発車ベル・緑電の「チンチン」・扉のチャイム・扉の開け閉め・運河バスの汽笛・駅員ロボの合図・駅の放送のチャイム・
 *   ホバーのファンを回す・止める音と、下りて止まる音
 * - くり返す音（LOOPS。4 秒。つなぎ目は重ねて消す）: 車輪の走る音・継ぎ目の音・きしみ・モーター・巻き上げ機・水の音・波を切る音・車室のこもった響き・
 *   ホバーのファン・飛ぶ間の風・浮遊レーンの配送機の羽音。
 *   速さで再生の速さ（音の高さ）と音量を変える
 */

export type OneShotId = 'cableBell' | 'tramGong' | 'doorChime' | 'doorOpen' | 'doorClose' | 'cableDoor' | 'horn' | 'robotSignal' | 'robotBow' | 'announce' | 'boatBump' | 'hoverUp' | 'hoverDown' | 'hoverTouch'
export type LoopId = 'rumble' | 'joints' | 'squeal' | 'tramMotor' | 'winch' | 'water' | 'wake' | 'boatMotor' | 'cabin' | 'idleHum' | 'hoverFan' | 'wind' | 'droneBuzz'

/** 乱数（mulberry32。種から毎回同じ列） */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 2 次の帯域通過・低域通過（RBJ）。x をその場で書き換える */
function biquad(x: Float32Array, rate: number, type: 'lp' | 'bp' | 'hp', f: number, q = 0.707) {
  const w = (2 * Math.PI * Math.min(f, rate * 0.45)) / rate
  const cs = Math.cos(w)
  const al = Math.sin(w) / (2 * q)
  let b0: number, b1: number, b2: number
  if (type === 'lp') {
    b0 = (1 - cs) / 2
    b1 = 1 - cs
    b2 = (1 - cs) / 2
  } else if (type === 'hp') {
    b0 = (1 + cs) / 2
    b1 = -(1 + cs)
    b2 = (1 + cs) / 2
  } else {
    b0 = al
    b1 = 0
    b2 = -al
  }
  const a0 = 1 + al
  const a1 = -2 * cs
  const a2 = 1 - al
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < x.length; i++) {
    const v = x[i]
    const y = (b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0
    x2 = x1
    x1 = v
    y2 = y1
    y1 = y
    x[i] = y
  }
  return x
}

const white = (n: number, r: () => number) => {
  const x = new Float32Array(n)
  for (let i = 0; i < n; i++) x[i] = r() * 2 - 1
  return x
}

/** 茶色の雑音（低い音の多い雑音） */
const brown = (n: number, r: () => number) => {
  const x = new Float32Array(n)
  let v = 0
  for (let i = 0; i < n; i++) {
    v = (v + (r() * 2 - 1) * 0.02) * 0.998
    x[i] = v * 6
  }
  return x
}

/** 最大の振れを peak に */
function normalize(x: Float32Array, peak: number) {
  let m = 1e-9
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]))
  const k = peak / m
  for (let i = 0; i < x.length; i++) x[i] *= k
  return x
}

/** 始めと終わりを短く絞る（つなぎ目のぷつっという音を消す） */
function fadeEdges(x: Float32Array, rate: number, a = 0.004, b = 0.03) {
  const na = Math.max(1, Math.round(a * rate))
  const nb = Math.max(1, Math.round(b * rate))
  for (let i = 0; i < na && i < x.length; i++) x[i] *= i / na
  for (let i = 0; i < nb && i < x.length; i++) x[x.length - 1 - i] *= i / nb
  return x
}

/** 長さ len + 重ね fade の音を、くり返してもつなぎ目の分からない len の音に（終わりの fade を始めに重ねる） */
function loopify(x: Float32Array, len: number, fade: number) {
  const out = new Float32Array(len)
  for (let i = 0; i < len; i++) out[i] = x[i]
  for (let i = 0; i < fade; i++) {
    const k = i / fade
    out[i] = x[len + i] * (1 - k) + x[i] * k
  }
  return out
}

/** 鐘の打つ音（周波数の比 ratios・強さ amps・減衰の秒 decays） */
function strike(out: Float32Array, rate: number, at: number, f0: number, ratios: number[], amps: number[], decays: number[], gain = 1) {
  const i0 = Math.round(at * rate)
  for (let k = 0; k < ratios.length; k++) {
    const f = f0 * ratios[k]
    const d = decays[k]
    const n = Math.min(out.length - i0, Math.round(d * 7 * rate))
    const w = (2 * Math.PI * f) / rate
    for (let i = 0; i < n; i++) {
      const t = i / rate
      const env = Math.exp(-t / d) * Math.min(1, t / 0.0015)
      out[i0 + i] += Math.sin(w * i + k) * amps[k] * env * gain
    }
  }
}

/** なめらかな音色の音（正弦と弱い倍音。チャイム） */
function tone(out: Float32Array, rate: number, at: number, f: number, dur: number, amp: number, release = 0.5) {
  const i0 = Math.round(at * rate)
  const n = Math.min(out.length - i0, Math.round((dur + release * 4) * rate))
  const w = (2 * Math.PI * f) / rate
  for (let i = 0; i < n; i++) {
    const t = i / rate
    const env = Math.min(1, t / 0.008) * (t < dur ? Math.exp(-t / (dur * 2.2)) : Math.exp(-dur / (dur * 2.2)) * Math.exp(-(t - dur) / release))
    out[i0 + i] += (Math.sin(w * i) + 0.18 * Math.sin(2 * w * i) + 0.06 * Math.sin(3 * w * i)) * amp * env
  }
}

/* -------------------------------------------------------------------------- */
/* 一度だけ鳴る音                                                                   */
/* -------------------------------------------------------------------------- */

function makeOneShot(id: OneShotId, rate: number): Float32Array {
  switch (id) {
    case 'cableBell': {
      // 発車ベル（電気のベル。小さな槌が金属の椀を毎秒 19 回打つ、ジリリリ… 3 秒）
      const out = new Float32Array(Math.round(3.4 * rate))
      const hits = Math.floor(3.0 * 19)
      for (let h = 0; h < hits; h++) strike(out, rate, h / 19, 1180, [1, 1.46, 2.07, 2.69, 3.5], [1, 0.62, 0.4, 0.26, 0.12], [0.06, 0.05, 0.035, 0.03, 0.02], 0.85 + 0.15 * ((h * 7) % 3) / 2)
      return fadeEdges(normalize(out, 0.9), rate, 0.002, 0.08)
    }
    case 'tramGong': {
      // 路面電車の「チンチン」（足で踏む小さな鐘を 2 回。少し違う強さ）
      const out = new Float32Array(Math.round(2.2 * rate))
      const r = [1, 2.0, 2.74, 3.93, 5.41]
      const a = [1, 0.42, 0.34, 0.18, 0.1]
      const d = [0.9, 0.55, 0.42, 0.25, 0.16]
      strike(out, rate, 0.0, 1475, r, a, d, 1)
      strike(out, rate, 0.3, 1475, r, a, d, 0.85)
      return fadeEdges(normalize(out, 0.9), rate, 0.001, 0.2)
    }
    case 'doorChime': {
      // 扉が開くときの 2 つの音のチャイム
      const out = new Float32Array(Math.round(1.6 * rate))
      tone(out, rate, 0, 1318.5, 0.28, 0.6, 0.25)
      tone(out, rate, 0.32, 1046.5, 0.32, 0.6, 0.3)
      return fadeEdges(normalize(out, 0.8), rate)
    }
    case 'doorOpen':
    case 'doorClose': {
      // 空気で動く扉（短い息の音・扉が滑る音・止まる所の小さな当たり）
      const r = rng(id === 'doorOpen' ? 11 : 12)
      const dur = id === 'doorOpen' ? 1.3 : 1.15
      const n = Math.round(dur * rate)
      const hiss = biquad(white(n, r), rate, 'bp', 3200, 0.8)
      const slide = biquad(brown(n, r), rate, 'lp', 420)
      const out = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        const t = i / rate
        const eh = id === 'doorOpen' ? Math.exp(-t / 0.18) * Math.min(1, t / 0.01) : Math.exp(-Math.abs(t - 0.05) / 0.12)
        const es = Math.sin(Math.min(1, t / (dur * 0.8)) * Math.PI) * 0.8
        out[i] = hiss[i] * eh * 0.5 + slide[i] * es
      }
      // 止まる所の当たり（低い「とん」）
      const ti = Math.round((dur - 0.25) * rate)
      for (let i = 0; i < Math.round(0.2 * rate) && ti + i < n; i++) {
        const t = i / rate
        out[ti + i] += Math.sin(2 * Math.PI * 95 * t) * Math.exp(-t / 0.04) * (id === 'doorClose' ? 1.2 : 0.7)
      }
      return fadeEdges(normalize(out, 0.7), rate)
    }
    case 'cableDoor': {
      // 外吊りの引き戸（戸車の転がる音と、止まる所の木と金の当たり）
      const r = rng(21)
      const n = Math.round(1.5 * rate)
      const roll = biquad(brown(n, r), rate, 'bp', 260, 1.2)
      const out = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        const t = i / rate
        out[i] = roll[i] * Math.sin(Math.min(1, t / 1.15) * Math.PI) * (1 + 0.3 * Math.sin(t * 60))
      }
      const ti = Math.round(1.15 * rate)
      const clack = biquad(white(Math.round(0.12 * rate), r), rate, 'bp', 1800, 2)
      for (let i = 0; i < clack.length && ti + i < n; i++) out[ti + i] += clack[i] * Math.exp(-i / rate / 0.025) * 2.5
      return fadeEdges(normalize(out, 0.7), rate)
    }
    case 'horn': {
      // 運河バスの汽笛（電動の小さな舟の、やわらかい 2 つの音の汽笛。1.2 秒）
      const n = Math.round(1.7 * rate)
      const out = new Float32Array(n)
      for (const [f, a] of [
        [311.1, 1],
        [392.0, 0.8],
      ] as const)
        for (let i = 0; i < n; i++) {
          const t = i / rate
          const env = Math.min(1, t / 0.06) * (t < 1.15 ? 1 : Math.exp(-(t - 1.15) / 0.12))
          const ph = 2 * Math.PI * f * t + 0.004 * Math.sin(2 * Math.PI * 5.5 * t) * f
          let v = 0
          for (let h = 1; h <= 7; h++) v += Math.sin(ph * h) / h ** 1.3
          out[i] += v * a * env
        }
      biquad(out, rate, 'lp', 1600, 0.7)
      return fadeEdges(normalize(out, 0.85), rate)
    }
    case 'robotSignal': {
      // 駅員ロボの発車の合図（やわらかい 3 つの音が上がる。0.9 秒）
      const out = new Float32Array(Math.round(1.5 * rate))
      tone(out, rate, 0, 659.3, 0.16, 0.5, 0.12)
      tone(out, rate, 0.17, 830.6, 0.16, 0.5, 0.12)
      tone(out, rate, 0.34, 987.8, 0.38, 0.55, 0.35)
      return fadeEdges(normalize(out, 0.7), rate)
    }
    case 'robotBow': {
      // 会釈の小さな電子の音（2 つの短い音）
      const out = new Float32Array(Math.round(0.6 * rate))
      tone(out, rate, 0, 1567.98, 0.05, 0.4, 0.05)
      tone(out, rate, 0.09, 2093, 0.07, 0.35, 0.08)
      return fadeEdges(normalize(out, 0.5), rate)
    }
    case 'announce': {
      // 駅の放送の前の短いチャイム（4 つの音が上がる、やわらかい鉄琴の音。1.8 秒）
      const out = new Float32Array(Math.round(2.6 * rate))
      const notes = [523.25, 659.25, 783.99, 1046.5]
      notes.forEach((f, k) => strike(out, rate, k * 0.26, f, [1, 3.0, 4.1], [1, 0.12, 0.05], [0.9, 0.25, 0.15], 0.8 + k * 0.05))
      return fadeEdges(normalize(out, 0.75), rate, 0.002, 0.3)
    }
    case 'hoverUp':
    case 'hoverDown': {
      // ホバーのファンを回す・止める（囲いのあるファンの唸りが上がる・下がる。回すときは始めに小さな 2 つの音の合図）
      const up = id === 'hoverUp'
      const dur = up ? 2.4 : 2.0
      const n = Math.round(dur * rate)
      const r = rng(up ? 61 : 62)
      const air = biquad(biquad(white(n, r), rate, 'bp', 900, 0.6), rate, 'lp', 3200)
      const out = new Float32Array(n)
      let ph = 0
      for (let i = 0; i < n; i++) {
        const t = i / rate
        const k = up ? Math.min(1, t / 1.9) : Math.max(0, 1 - t / 1.7)
        const e = k * k * (3 - 2 * k)
        const f = 150 + 330 * e
        ph += (2 * Math.PI * f) / rate
        const env = up ? Math.min(1, t / 0.3) * (t > dur - 0.4 ? (dur - t) / 0.4 : 1) : Math.min(1, t / 0.05) * (1 - t / dur)
        out[i] = (Math.sin(ph) * 0.5 + Math.sin(ph * 2 + 0.4) * 0.22 + Math.sin(ph * 3 + 1) * 0.1) * env * (0.35 + 0.65 * e) + air[i] * env * e * 0.9
      }
      if (up) {
        tone(out, rate, 0.05, 1318.5, 0.07, 0.35, 0.08)
        tone(out, rate, 0.17, 1975.5, 0.12, 0.3, 0.14)
      }
      return fadeEdges(normalize(out, 0.7), rate)
    }
    case 'hoverTouch': {
      // 地面に下りる（ゴムの脚が道に当たる、やわらかい低い「とん」）
      const r = rng(63)
      const n = Math.round(0.5 * rate)
      const out = biquad(brown(n, r), rate, 'lp', 260)
      for (let i = 0; i < n; i++) {
        const t = i / rate
        out[i] = out[i] * Math.exp(-t / 0.07) + Math.sin(2 * Math.PI * 68 * t) * Math.exp(-t / 0.06) * 0.9
      }
      return fadeEdges(normalize(out, 0.6), rate)
    }
    case 'boatBump': {
      // 舟が下の段の防舷材に当たる小さな音（ゴムと木）
      const r = rng(31)
      const n = Math.round(0.6 * rate)
      const out = biquad(brown(n, r), rate, 'lp', 300)
      for (let i = 0; i < n; i++) out[i] *= Math.exp(-i / rate / 0.09)
      return fadeEdges(normalize(out, 0.6), rate)
    }
  }
}

/* -------------------------------------------------------------------------- */
/* くり返す音（4 秒）                                                               */
/* -------------------------------------------------------------------------- */

const LOOP_SEC = 4

function makeLoop(id: LoopId, rate: number): Float32Array {
  const len = LOOP_SEC * rate
  const fade = Math.round(0.3 * rate)
  const n = len + fade
  switch (id) {
    case 'rumble': {
      // 車輪の転がる低い音（茶色の雑音を絞る）
      const x = biquad(biquad(brown(n, rng(41)), rate, 'lp', 260), rate, 'hp', 35)
      return normalize(loopify(x, len, fade), 0.8)
    }
    case 'joints': {
      // レールの継ぎ目（「たたん、たたん」。4 秒に 2 組。速さで再生の速さを上げると間が詰まる）
      const r = rng(42)
      const x = biquad(brown(n, r), rate, 'lp', 180)
      for (let i = 0; i < n; i++) x[i] *= 0.25
      for (const at of [0.3, 0.42, 2.3, 2.42]) {
        const i0 = Math.round(at * rate)
        const click = biquad(white(Math.round(0.1 * rate), r), rate, 'bp', 700, 1.4)
        for (let i = 0; i < click.length; i++) {
          const t = i / rate
          x[i0 + i] += (click[i] * 1.6 + Math.sin(2 * Math.PI * 120 * t) * 0.9) * Math.exp(-t / 0.03)
        }
      }
      return normalize(loopify(x, len, fade), 0.8)
    }
    case 'squeal': {
      // 車輪・綱車のきしみ（細い帯の高い音が、ゆっくり強くなったり弱くなったり）
      const r = rng(43)
      const x = biquad(biquad(white(n, r), rate, 'bp', 2350, 18), rate, 'bp', 2350, 6)
      for (let i = 0; i < n; i++) {
        const t = i / rate
        x[i] *= 0.35 + 0.65 * Math.max(0, Math.sin(t * 1.9) * Math.sin(t * 0.7 + 1))
      }
      return normalize(loopify(x, len, fade), 0.6)
    }
    case 'tramMotor': {
      // 緑電のやわらかいモーターの音（110 Hz の倍音と、少し高い唸り。4 秒でちょうど回るので、つなぎ目が無い）
      const x = new Float32Array(len)
      for (let i = 0; i < len; i++) {
        const t = i / rate
        let v = 0
        for (let h = 1; h <= 9; h++) v += Math.sin(2 * Math.PI * 110 * h * t + h) / (h * 1.4)
        v += 0.35 * Math.sin(2 * Math.PI * 770 * t) + 0.18 * Math.sin(2 * Math.PI * 1100 * t)
        x[i] = v
      }
      return normalize(x, 0.6)
    }
    case 'winch': {
      // ケーブルの巻き上げ機（低い唸り 47.5 Hz と歯車の音 950 Hz、機械の雑音）
      const r = rng(44)
      const noise = biquad(brown(len, r), rate, 'lp', 300)
      const x = new Float32Array(len)
      for (let i = 0; i < len; i++) {
        const t = i / rate
        x[i] = Math.sin(2 * Math.PI * 47.5 * t) + 0.5 * Math.sin(2 * Math.PI * 95 * t + 1) + 0.12 * Math.sin(2 * Math.PI * 950 * t) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 2 * t)) + noise[i] * 0.4
      }
      return normalize(x, 0.7)
    }
    case 'water': {
      // 岸・舟べりの水の音（ちゃぷちゃぷ。帯域を絞った雑音に、ゆっくりした波の強弱）
      const r = rng(45)
      const x = biquad(biquad(white(n, r), rate, 'bp', 650, 0.9), rate, 'lp', 1800)
      let env = 0
      let target = 0
      for (let i = 0; i < n; i++) {
        if (i % Math.round(0.18 * rate) === 0) target = r() < 0.45 ? 0.3 + r() * 0.9 : 0.05
        env += (target - env) * 0.0009
        x[i] *= env
      }
      return normalize(loopify(x, len, fade), 0.6)
    }
    case 'wake': {
      // 舟が水を切る音（さあっという広い雑音）
      const x = biquad(biquad(white(n, rng(46)), rate, 'hp', 900), rate, 'lp', 5200)
      for (let i = 0; i < n; i++) x[i] *= 0.8 + 0.2 * Math.sin((i / rate) * 3.1)
      return normalize(loopify(x, len, fade), 0.5)
    }
    case 'boatMotor': {
      // 運河バスの静かな電気のモーター（82.5 Hz の倍音と高い唸り）
      const x = new Float32Array(len)
      for (let i = 0; i < len; i++) {
        const t = i / rate
        let v = 0
        for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * 82.5 * h * t + h * 0.7) / (h * 1.8)
        v += 0.22 * Math.sin(2 * Math.PI * 1320 * t) + 0.08 * Math.sin(2 * Math.PI * 2640 * t)
        x[i] = v
      }
      return normalize(x, 0.55)
    }
    case 'cabin': {
      // 車室の中のこもった響き（とても低い揺れ）
      const x = biquad(biquad(brown(n, rng(47)), rate, 'lp', 140), rate, 'hp', 28)
      return normalize(loopify(x, len, fade), 0.8)
    }
    case 'hoverFan': {
      // ホバーの囲いのあるファン（羽根の通る音 240 Hz の倍音と、空気の帯の雑音。4 秒でちょうど回る）
      const r = rng(64)
      const air = biquad(biquad(white(n, r), rate, 'bp', 1100, 0.55), rate, 'lp', 4200)
      const x = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        const t = i / rate
        let v = 0
        for (let h = 1; h <= 5; h++) v += Math.sin(2 * Math.PI * 240 * h * t + h * 0.9) / (h * 1.7)
        x[i] = v * 0.45 * (0.92 + 0.08 * Math.sin(2 * Math.PI * 1.5 * t)) + air[i] * 0.85
      }
      return normalize(loopify(x, len, fade), 0.6)
    }
    case 'wind': {
      // 飛ぶ間の風（ゆっくり強くなったり弱くなったりする低めの風の音）
      const r = rng(65)
      const x = biquad(biquad(white(n, r), rate, 'lp', 900), rate, 'hp', 70)
      for (let i = 0; i < n; i++) {
        const t = i / rate
        x[i] *= 0.7 + 0.3 * Math.sin(t * 1.3 + Math.sin(t * 0.47) * 2)
      }
      return normalize(loopify(x, len, fade), 0.6)
    }
    case 'droneBuzz': {
      // 浮遊レーンの配送機の羽音（小さな 4 つの羽根。高めの唸り 330 Hz と少しずれた 347 Hz のうなり）
      const r = rng(66)
      const air = biquad(white(len, r), rate, 'bp', 2400, 1.2)
      const x = new Float32Array(len)
      for (let i = 0; i < len; i++) {
        const t = i / rate
        let v = 0
        for (let h = 1; h <= 4; h++) v += (Math.sin(2 * Math.PI * 330 * h * t) + 0.8 * Math.sin(2 * Math.PI * 347.25 * h * t + 1)) / (h * 1.5)
        x[i] = v * 0.4 + air[i] * 0.3
      }
      return normalize(x, 0.5)
    }
    case 'idleHum': {
      // 止まっている電車の補機（空気の圧縮機・冷房のかすかな唸り）
      const r = rng(48)
      const noise = biquad(white(len, r), rate, 'bp', 1200, 1.1)
      const x = new Float32Array(len)
      for (let i = 0; i < len; i++) {
        const t = i / rate
        x[i] = 0.5 * Math.sin(2 * Math.PI * 100 * t) + 0.25 * Math.sin(2 * Math.PI * 300 * t) + noise[i] * 0.3
      }
      return normalize(x, 0.4)
    }
  }
}

/* -------------------------------------------------------------------------- */
/* AudioBuffer（音の環境ごとに 1 回作って覚える）                                     */
/* -------------------------------------------------------------------------- */

const cache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>()
const pcm = new Map<string, Float32Array>()

function buffer(ctx: BaseAudioContext, key: string, make: (rate: number) => Float32Array) {
  let m = cache.get(ctx)
  if (!m) cache.set(ctx, (m = new Map()))
  let b = m.get(key)
  if (b) return b
  const pk = `${key}@${ctx.sampleRate}`
  let data = pcm.get(pk)
  if (!data) pcm.set(pk, (data = make(ctx.sampleRate)))
  b = ctx.createBuffer(1, data.length, ctx.sampleRate)
  b.copyToChannel(data as Float32Array<ArrayBuffer>, 0)
  m.set(key, b)
  return b
}

export function oneShotBuffer(ctx: BaseAudioContext, id: OneShotId) {
  return buffer(ctx, `o:${id}`, (rate) => makeOneShot(id, rate))
}

export function loopBuffer(ctx: BaseAudioContext, id: LoopId) {
  return buffer(ctx, `l:${id}`, (rate) => makeLoop(id, rate))
}

/** 素材を全部先に作る（最初の音が鳴る前。重い計算を走っている途中にしないように） */
export function warmSounds(ctx: BaseAudioContext) {
  const ones: OneShotId[] = ['cableBell', 'tramGong', 'doorChime', 'doorOpen', 'doorClose', 'cableDoor', 'horn', 'robotSignal', 'robotBow', 'announce', 'boatBump', 'hoverUp', 'hoverDown', 'hoverTouch']
  const loops: LoopId[] = ['rumble', 'joints', 'squeal', 'tramMotor', 'winch', 'water', 'wake', 'boatMotor', 'cabin', 'idleHum', 'hoverFan', 'wind', 'droneBuzz']
  for (const o of ones) oneShotBuffer(ctx, o)
  for (const l of loops) loopBuffer(ctx, l)
}
