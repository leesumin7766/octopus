import { useCallback, useEffect, useRef, useState } from 'react'
import { defaultSetting, type SettingKey, type SettingsMap } from '../../shared/settings/schema'
import { safeInvoke } from '../safeInvoke'

export interface UseSetting<K extends SettingKey> {
  /** 저장된 값. 처음 읽어 오기 전에는 null. */
  value: SettingsMap[K] | null
  /** 화면에서만 바꾼다(끌어서 크기를 바꾸는 동안처럼 자주 바뀔 때). */
  setLocal: (next: SettingsMap[K]) => void
  /** 지금 값(또는 넘긴 값)을 저장한다. 여러 번 겹치면 마지막 요청의 결과만 화면 상태에 반영한다. */
  persist: (next?: SettingsMap[K]) => void
  /** 가장 최근 저장이 실패했는지. true 면 화면 값은 아직 저장되지 않은 값이다(revertOnFailure 를 쓰면 항상 false). */
  saveFailed: boolean
  /** 마지막 저장 요청이 응답을 기다리는 중인지. true 인 동안 retry 는 아무것도 하지 않는다. */
  saving: boolean
  /** 지금 화면 값을 다시 저장한다([다시 시도]). 저장 중이면 무시한다. */
  retry: () => void
}

export interface UseSettingOptions {
  /** 저장이 실패하면 화면 값을 실제로 저장된 값으로 되돌린다. 알림 자리가 마땅치 않은 곳에 쓴다. */
  revertOnFailure?: boolean
}

/** 설정 하나를 읽고 저장하는 훅. 못 읽으면(DB 없음 등) 기본값으로 계속 동작한다. */
export function useSetting<K extends SettingKey>(key: K, options: UseSettingOptions = {}): UseSetting<K> {
  const revertOnFailure = options.revertOnFailure === true
  const [value, setValue] = useState<SettingsMap[K] | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const latest = useRef<SettingsMap[K] | null>(null)
  // 실제로 저장된 값이라고 확인된 마지막 값과, 그 값을 낸 요청 번호.
  // 요청 번호가 더 뒤인 성공만 이긴다(늦게 온 이전 성공이 더 나중 값을 덮지 않게 한다).
  const confirmed = useRef<SettingsMap[K] | null>(null)
  const confirmedNo = useRef(0)
  // 저장 요청마다 번호를 붙인다. 화면 상태(오류·되돌리기·저장 중)는 마지막 요청의 응답만으로 정한다.
  const requestNo = useRef(0)
  const pendingLatest = useRef(false)
  // 마지막 요청이 실패해 화면을 되돌렸는지. 그 뒤 늦게 온 이전 요청의 성공은 실제 저장 값으로 화면을 맞춘다.
  const latestFailed = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    void safeInvoke(() => window.octopus.settings.get(key)).then((result) => {
      if (!mounted.current) return
      const loaded = result.ok ? result.data : defaultSetting(key)
      // 읽어 오는 사이에 이미 바꾼 값이 있으면 그것을 지키지 않고 저장된 값으로 시작한다(처음 한 번뿐).
      latest.current = loaded
      confirmed.current = loaded
      setValue(loaded)
    })
    return () => {
      mounted.current = false
    }
  }, [key])

  const setLocal = useCallback((next: SettingsMap[K]) => {
    latest.current = next
    setValue(next)
  }, [])

  /** 화면 값을 실제로 저장된 값으로 맞춘다(되돌리기). */
  const showConfirmed = useCallback(() => {
    if (confirmed.current === null) return
    latest.current = confirmed.current
    setValue(confirmed.current)
    setSaveFailed(false)
  }, [])

  const send = useCallback(
    (toSave: SettingsMap[K]) => {
      const no = ++requestNo.current
      pendingLatest.current = true
      latestFailed.current = false
      setSaving(true)
      void safeInvoke(() => window.octopus.settings.set(key, toSave)).then((result) => {
        // 저장된 값의 기준은 요청 번호다. 더 뒤의 요청이 이미 성공했으면 이 성공은 낡은 것이다.
        if (result.ok && no > confirmedNo.current) {
          confirmedNo.current = no
          confirmed.current = toSave
        }
        if (!mounted.current) return
        if (no !== requestNo.current) {
          // 낡은 응답은 오류·저장 중 표시를 건드리지 않는다. 다만 최근 요청이 실패해 되돌렸다면,
          // 여기서 실제로 저장된 값이 바뀌었으니 화면을 그 값에 맞춘다.
          if (result.ok && revertOnFailure && latestFailed.current) showConfirmed()
          return
        }
        pendingLatest.current = false
        setSaving(false)
        if (result.ok) {
          setSaveFailed(false)
          return
        }
        if (revertOnFailure) {
          latestFailed.current = true
          showConfirmed()
          return
        }
        setSaveFailed(true)
      })
    },
    [key, revertOnFailure, showConfirmed]
  )

  const persist = useCallback(
    (next?: SettingsMap[K]) => {
      const toSave = next ?? latest.current
      if (toSave === null) return
      latest.current = toSave
      send(toSave)
    },
    [send]
  )

  const retry = useCallback(() => {
    if (pendingLatest.current) return
    persist()
  }, [persist])

  return { value, setLocal, persist, saveFailed, saving, retry }
}
