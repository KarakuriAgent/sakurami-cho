import { useEffect, type ReactNode } from 'react'
import { createPortal, useThree } from '@react-three/fiber'
import { useLab } from './labHooks'

/**
 * ラボの R3F の薄い包みのうち、空気と差し込み口（docs/design/map-split.md §6 の「段 4」・4-3〜4-5・4-10。案の §4.3）。中身は three の形
 * （world/lab の createLab）で、ここは React の時期（effect・portal）に合わせて付けるだけ。テクスチャを待ってラボを作る所（TownRoot）と、
 * 照明・殻・什器を置いて毎コマ動かす所（TownView）は、5-6 で町の包み TownView.tsx へ移した（毎コマは町の段 town.view）
 *
 * - LabAtmosphere: 空気（光の筋・ほこり）
 * - LabSlot: 差し込み口（lab.slots の名前）の入れ物に、R3F の子を portal で入れる（4-10。ギャラリーの KB-γ の模型など）
 */

/** 空気（光の筋・ほこり）。ほこりの粒の大きさは画面の画素の比に合わせる */
export function LabAtmosphere() {
  const { atmosphere } = useLab()
  const dpr = useThree((s) => s.viewport.dpr)
  useEffect(() => atmosphere.setPixelRatio(dpr), [atmosphere, dpr])
  useEffect(() => atmosphere.attach(), [atmosphere])
  return <primitive object={atmosphere.object} />
}

/**
 * 差し込み口（キットの「置き場所の id.差し込み口の名前」か lighting.stage）の入れ物に、R3F の子を portal で入れる（4-10）。
 * 子は入れ物（持ち主が動かす群）の子になり、毎コマの購読は置いた位置の順。差し込み口が無ければ（表から外した什器）何も出さない。
 * 入れ物にはラボの口の中身（labHost.ts の slots）も入れられるが、同じ差し込み口に両方は入れない
 */
export function LabSlot({ name, children }: { name: string; children: ReactNode }) {
  const slot = useLab().slots.get(name)
  if (!slot) return null
  return createPortal(children, slot.object)
}
