import { useEffect, useState, useSyncExternalStore, type ChangeEvent } from 'react'
import { clearVrm, loadVrmFile, setHeight, setNormalize, subscribeVrm, vrmState, type VrmState } from '../vrm'

/**
 * VRM を読むつまみ（左上）と、画面へのドラッグ＆ドロップ。読むのは vrm.ts（blob: の URL にして地図の見た目で読む）。
 * - ファイルを選ぶ（input type=file。確かめの道具は data-walker="vrm" で探す）か、画面のどこかへ落とす
 * - 身長を設定に合わせる・合わせない、設定の身長（cm）。変えたら同じファイルを読み直す
 * - 外す（仮の体に戻す。このブラウザにしまった VRM も消す）
 * - 読めた VRM はこのブラウザにしまい（vrm.ts・vrmStore.ts）、読み直しても使う。しまえないブラウザでは、そのことを案内に出す
 * - 様子と案内（読み込み中・読んだ VRM の版と実測の身長・読めなかった理由）
 */
export function VrmPanel() {
  const vrm = useSyncExternalStore(subscribeVrm, vrmState)
  const dragging = useFileDrop()
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) loadVrmFile(file)
    // 同じファイルをもう一度選んでも読むように
    e.target.value = ''
  }
  return (
    <>
      <section className="panel vrm-panel" aria-label="VRM">
        <h1 className="panel-title">town-walker</h1>
        <label className="button">
          VRM を選ぶ
          <input type="file" accept=".vrm" data-walker="vrm" onChange={onFile} hidden />
        </label>
        {vrm.fileName && (
          <button type="button" className="button secondary" onClick={clearVrm}>
            外す
          </button>
        )}
        <p className="hint">画面へ .vrm を落としても読みます（VRM 0.x・1.0）</p>
        <p className="hint" data-walker="vrm-stored">{storedText(vrm)}</p>
        <label className="row">
          <input type="checkbox" checked={vrm.normalize} onChange={(e) => setNormalize(e.target.checked)} data-walker="normalize" />
          身長を合わせる
        </label>
        <label className="row">
          身長
          <input
            type="number"
            min={50}
            max={250}
            step={1}
            value={Math.round(vrm.height * 100)}
            disabled={!vrm.normalize}
            onChange={(e) => setHeight(Number(e.target.value) / 100)}
            data-walker="height"
          />
          cm
        </label>
        <p className={`status status-${vrm.status}`} data-walker="vrm-status" aria-live="polite">
          {statusText(vrm)}
        </p>
      </section>
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          ここに落とすと VRM を読みます
        </div>
      )}
    </>
  )
}

/** しまった VRM の案内の字 */
function storedText(s: VrmState): string {
  switch (s.stored) {
    case 'unavailable':
      return 'このブラウザにはしまえません（読み直すと消える）'
    case 'skipped':
      return 'しまった VRM は使わずに入りました（選ぶと入れ替える）'
    case 'saved':
      return 'このブラウザにしまい、読み直しても使います（「外す」で消す）'
    default:
      return '読めた VRM はこのブラウザにしまい、どこへも送りません'
  }
}

/** 様子の字 */
function statusText(s: VrmState): string {
  const name = s.fileName ? `「${s.fileName}」` : ''
  switch (s.status) {
    case 'none':
      return 'VRM なし（仮の体）'
    case 'rejected':
      return s.message
    case 'loading':
      return `${name}を読み込み中…`
    case 'ready': {
      const version = s.version === '0' ? 'VRM 0.x' : 'VRM 1.0'
      const height = s.measured ? `${(s.measured * 100).toFixed(1)}cm` : '—'
      const note = s.message ? `（${s.message}）` : ''
      return `${name}（${version}）身長 ${height}${s.normalize ? '（設定に合わせた）' : '（元の大きさ）'}${note}`
    }
    default:
      return `${name}${s.message}（仮の体のまま）`
  }
}

/** 画面へファイルを落としたら読む（ページのどこでも）。ファイルを持って画面の上にいる間は true */
function useFileDrop(): boolean {
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth++
      setDragging(true)
    }
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      const file = e.dataTransfer?.files[0]
      if (file) loadVrmFile(file)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [])
  return dragging
}
