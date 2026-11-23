import type { TaskRepository } from './taskRepository'

/**
 * 할 일을 바꾸는 호출이 끝난 뒤 emit() 을 부르는 저장소 감싸개. 읽기 호출은 그대로 둔다.
 * 루틴·메모·수신함 후보가 만드는 할 일도 이 저장소를 쓰므로 한 곳에서 모든 변경을 알 수 있다.
 */
export function notifyOnChange(repo: TaskRepository, emit: () => void): TaskRepository {
  const wrap = <A extends unknown[], R>(fn: (...args: A) => R) => (...args: A): R => {
    const result = fn(...args)
    emit()
    return result
  }
  return {
    ...repo,
    create: wrap(repo.create),
    update: wrap(repo.update),
    setStatus: wrap(repo.setStatus),
    remove: wrap(repo.remove),
    reorder: wrap(repo.reorder),
    moveToToday: wrap(repo.moveToToday),
    moveToSomeday: wrap(repo.moveToSomeday),
    reschedule: wrap(repo.reschedule)
  }
}
