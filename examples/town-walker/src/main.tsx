// 町（地図）を作る（地図のモジュールが引数を使う前に。いちばん先に読む）
import './town'
// 町の時刻（?time・?date）を描き始める前に入れる
import './clock'
import './debug'
// 読み込み中の進み具合（walk/index.html の #loading を引き継ぐ。スクリプトの段はここで済み）
import { loadingFonts, loadingRender } from './loading'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { FONTS } from 'sakurami-cho/world'
import App from './App'

/**
 * ラボの看板・画面（Canvas に描くラベル）が正しいフォントで描かれるよう、Web フォント（walk/index.html で読む）の読み込みを待ってから描き始める
 * （最大 3 秒。オフラインでも起動はする）。
 *
 * Web フォントは字の範囲（unicode-range）ごとに分かれて届き、Canvas に字を描いても、その範囲は読み込まれない（読み込む前の字は代わりのフォントで描かれ、
 * 一度だけ描くラベルはそのまま残る）。それで、地図のラボが FONTS（Orbitron・Share Tech Mono・Noto Sans JP が頭のフォント）で描く字を、ここで先に読んでおく。
 * 字は 6-6 に確かめの道具で数えた物（地図の既定のラボで、起動から 90 秒のあいだに Canvas に描いた字。英数と記号は ASCII を全部）。
 * ラボの字を変えたら数え直す（6-1 からの仮「待つ字は例のアプリが選ぶ」の見直し）。
 * 町の看板・名前のある建物・中のある建物の絵の字は、頭のフォントが OS の "Noto Sans CJK JP" なので待たない（無い OS では Web フォントの範囲を読む前に
 * 描くと、その OS の日本語のフォントで描かれる）
 */
const ASCII = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)).join('')
const LAB_GLYPHS =
  '°·αβγ–→⎇✓「」〜' +
  'かきくさじすせてでとにのはひふめらりるわを' +
  'エガクサジスタダテトネバブペホボラリルロン・ー' +
  '二交信公冷刃分却口号図学安定室少庫拠持換料新更最木桜械棚機残浮湯源災点父版用町登確種第給維耳見解認資通配録開防電面高' +
  // 6-1 から入れていた字（ラボの扉の表示板・ひらき札など）
  'ラボ看板電源室冷却機械給湯資料庫通用口見学エントランスひらき公開第二種桜見町登録号防災拠点父からはじめての'
const FONT_GLYPHS = [...new Set(ASCII + LAB_GLYPHS)].join('')

async function waitForFonts() {
  if (!('fonts' in document)) return loadingFonts(0, 0)
  // Orbitron は 500・700・900 を読む（ラボは太さを書かない字（400）も描き、いちばん近い 500 で描かれる）
  const loads = [`900 32px ${FONTS.display}`, `700 32px ${FONTS.display}`, `500 32px ${FONTS.display}`, `32px ${FONTS.mono}`, `400 32px ${FONTS.jp}`, `700 32px ${FONTS.jp}`].map((f) =>
    document.fonts.load(f, FONT_GLYPHS),
  )
  // 進み具合のフォントの段（読み終えた・読めなかった数）
  let settled = 0
  loadingFonts(0, loads.length)
  const tick = () => loadingFonts(++settled, loads.length)
  for (const l of loads) l.then(tick, tick)
  const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 3000))
  if ((await Promise.race([Promise.allSettled(loads), timeout])) === 'timeout') loadingFonts(settled, loads.length, true)
}

waitForFonts().finally(() => {
  loadingRender()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
