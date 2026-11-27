/** 새 메모 저장이 성공한 뒤 칸에 남길 글: 칸이 보낸 글과 같으면 비우고, 그 밖에는 칸을 그대로 둔다. */
export function leftoverAfterSave(current: string, sent: string): string {
  return current === sent ? '' : current
}
