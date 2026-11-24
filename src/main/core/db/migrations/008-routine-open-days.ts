import type { Migration } from '../migrate'

// 앱이 루틴 항목을 만든 날(= 그날 앱을 켰다). 격자에서 "앱을 안 켠 날"을 구분하는 데 쓴다.
// 기존 사용자는 이 표가 비어 있으므로, 이전 날짜는 모두 "앱을 안 켠 날"로 보인다.
export const migration008: Migration = {
  version: 8,
  name: 'routine-open-days',
  up(db) {
    db.exec(`
      CREATE TABLE routine_open_days (
        date TEXT PRIMARY KEY
      );
    `)
  }
}
