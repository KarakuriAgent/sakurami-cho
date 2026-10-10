import { ENTRANCE_DOOR, ROOM } from '../../../core/lab/plan'

/**
 * 見学エントランスのガラスの扉（自動の開き戸。外開きの両開き）の開き具合（docs/design/map-split.md §6 の「段 4」・4-4。前の zones/entranceDoor.ts）。
 * 花音か KB-001 が扉の前（ENTRANCE_DOOR.sensor m 以内）に来ると開き、離れて少したつと閉じる（entrance.ts が毎コマ進める）。
 * 開き戸にしたのは、中の扉の形（両開きのガラスの框戸と縦の取っ手）を変えずに、外のテラスの側へ開けるため（§7 の 32）
 */
export const entranceDoor = {
  /** 0（閉）〜 1（開）。なめらかにした値 */
  open: 0,
  /** 最後に誰かが扉の前にいた時刻（シーンの秒） */
  lastNear: -100,
}

/** 扉の中心（シーンの x, z。南のガラスの面） */
export const DOOR_CENTER = { x: ENTRANCE_DOOR.x, z: ROOM.south }

/** 扉を進める。near = 誰かが扉の前にいるか、t = シーンの時刻、dt = 1 コマの秒 */
export function stepEntranceDoor(near: boolean, t: number, dt: number) {
  const d = entranceDoor
  if (near) d.lastNear = t
  const opening = t - d.lastNear < 1.4
  const rate = opening ? 1 / ENTRANCE_DOOR.openSeconds : -1 / ENTRANCE_DOOR.closeSeconds
  d.open = Math.min(1, Math.max(0, d.open + rate * dt))
}

/** 開き具合（0〜1）から扉の角度（rad。なめらかに動き出して止まる） */
export function doorAngle(open: number) {
  const k = open * open * (3 - 2 * open)
  return ENTRANCE_DOOR.openAngle * k
}
