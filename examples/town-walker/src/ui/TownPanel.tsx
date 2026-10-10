import { useState, useSyncExternalStore, type PointerEvent } from 'react'
import { clockCarry, clockUi, resetClock, runClock, setClockDate, setClockMinutes, setClockSpeed, SPEED_CHOICES, stopClock, subscribeClock, type ClockUi } from '../clock'
import { LAB_CHOICES, QUALITY, reloadWithQuality, TOWN_CHOICES, type LabQuality } from '../quality'
import type { TownQualityName } from 'sakurami-cho/core'

/**
 * 町の時刻と画質（左、VRM のつまみの下）。動かすのは clock.ts（時刻）と quality.ts（画質）。
 * - 時刻: つまみ（その日の 0:00〜23:59）・進める／止める・進める速さ・今に戻す・日付。旅程の途中・乗り物に乗っている間・ワープの暗転の間は変えない（仮）
 * - 画質（たたむ）: ラボと光・町の段。選ぶと引数を付けてページを読み込み直す（町は 1 ページに 1 回しか作れないため）
 * 確かめの道具は data-walker（time-slider・time-run・time-stop・time-speed・time-now・time-date・quality-lab・quality-town）で押す
 */
export function TownPanel() {
  const ui = useSyncExternalStore(subscribeClock, clockUi)
  const [open, setOpen] = useState(true)
  if (!open) {
    return (
      <section className="panel town-panel closed" aria-label="時刻と画質">
        <button type="button" className="button" data-walker="town-panel-open" onClick={() => setOpen(true)}>
          時刻 ・ {ui.label}
        </button>
      </section>
    )
  }
  return (
    <section className="panel town-panel" aria-label="時刻と画質">
      <div className="panel-head">
        <h2 className="panel-title">時刻</h2>
        <span className="clock" data-walker="clock-label">
          {ui.label}
        </span>
        <button type="button" className="button secondary small" onClick={() => setOpen(false)}>
          たたむ
        </button>
      </div>
      <TimeControls ui={ui} />
      <QualityControls />
    </section>
  )
}

/** マウスで動かし終えたら、つまみからフォーカスを外す（WASD は入力欄にいる間は取らないので、すぐ歩けるように） */
const release = (e: PointerEvent<HTMLElement>) => e.currentTarget.blur()

function TimeControls({ ui }: { ui: ClockUi }) {
  const locked = ui.locked !== null
  const state = ui.mode === 'now' ? '今の時刻（実時間）' : ui.mode === 'run' ? `進めている（${SPEED_CHOICES.find((c) => c.speed === ui.speed)?.label ?? `${ui.speed} 倍`}）` : '止めている'
  return (
    <div className="time" data-walker="time">
      <input
        type="range"
        className="time-slider"
        min={0}
        max={24 * 60 - 1}
        step={1}
        value={ui.minutes}
        disabled={locked}
        aria-label="町の時刻"
        data-walker="time-slider"
        onChange={(e) => setClockMinutes(Number(e.target.value))}
        onPointerUp={release}
      />
      <p className="hint time-state">
        {ui.date} {ui.period}・{state}
      </p>
      <div className="row">
        {ui.mode === 'stop' ? (
          <button type="button" className="button small" disabled={locked} data-walker="time-run" onClick={() => runClock()}>
            進める
          </button>
        ) : (
          <button type="button" className="button small" disabled={locked} data-walker="time-stop" onClick={() => stopClock()}>
            止める
          </button>
        )}
        <select value={ui.mode === 'now' ? 1 : ui.speed} disabled={locked} aria-label="進める速さ" data-walker="time-speed" onChange={(e) => setClockSpeed(Number(e.target.value))} onPointerUp={release}>
          {SPEED_CHOICES.map((c) => (
            <option key={c.speed} value={c.speed}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className="row">
        日付
        <input type="date" value={ui.date} disabled={locked} data-walker="time-date" onChange={(e) => e.target.value && setClockDate(e.target.value)} />
        {(ui.mode !== 'now' || ui.dateFixed || ui.drift) && (
          <button type="button" className="button secondary small" disabled={locked} data-walker="time-now" onClick={() => resetClock()}>
            今に戻す
          </button>
        )}
      </div>
      {(ui.locked ?? ui.message) && <p className="status status-cancelled">{ui.locked ?? ui.message}</p>}
    </div>
  )
}

/** 画質（たたんでおく）。選ぶと読み込み直す */
function QualityControls() {
  const label = (q: { id: string; label: string }[], id: string) => q.find((c) => c.id === id)?.label ?? id
  const choose = (lab: LabQuality, town: TownQualityName) => reloadWithQuality({ lab, town }, clockCarry())
  return (
    <details className="options quality" data-walker="quality">
      <summary>
        画質: ラボ {label([...LAB_CHOICES], QUALITY.lab)}・町 {label([...TOWN_CHOICES], QUALITY.town)}
      </summary>
      <label className="row">
        ラボと光
        <select value={QUALITY.lab} data-walker="quality-lab" onChange={(e) => choose(e.target.value as LabQuality, QUALITY.town)}>
          {LAB_CHOICES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="row">
        町
        <select value={QUALITY.town} data-walker="quality-town" onChange={(e) => choose(QUALITY.lab, e.target.value as TownQualityName)}>
          {TOWN_CHOICES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">画質は町を作るときに決まるので、選ぶとページを読み込み直します（URL の ?quality・?town。止めた時刻と日付は引き継ぎ、VRM と歩く人の位置は初めに戻ります）</p>
    </details>
  )
}
