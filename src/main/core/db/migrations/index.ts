import type { Migration } from '../migrate'
import { migration001 } from './001-app-meta'
import { migration002 } from './002-tasks'
import { migration003 } from './003-routines'
import { migration004 } from './004-memos'

// 새 마이그레이션은 파일을 하나 만들고 여기에 번호 순서로 추가한다.
export const migrations: readonly Migration[] = [migration001, migration002, migration003, migration004]
