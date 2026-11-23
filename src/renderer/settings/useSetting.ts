import { useCallback, useEffect, useRef, useState } from 'react'
import { defaultSetting, type SettingKey, type SettingsMap } from '../../shared/settings/schema'
import { safeInvoke } from '../safeInvoke'

export interface UseSetting<K extends SettingKey> {
  /** 저장된 값. 처음 읽어 오기 전에는 null. */
  value: SettingsMap[K] | null
  /** 화면에서만 바꾼다(끌어서 크기를 바꾸는 동안처럼 자주 바뀔 때). */
  setLocal: (next: SettingsMap[K]) => void
  /** 지금 값(또는 넘긴 값)을 저장한다. 저장에 실패해도 이번 실행 동안은 화면 값이 그대로 쓰인다. */
  persist: (next?: SettingsMap[K]) => void
}

/** 설정 하나를 읽고 저장하는 훅. 못 읽으면(DB 없음 등) 기본값으로 계속 동작한다. */
export function useSetting<K extends SettingKey>(key: K): UseSetting<K> {
  const [value, setValue] = useState<SettingsMap[K] | null>(null)
  const latest = useRef<SettingsMap[K] | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    void safeInvoke(() => window.octopus.settings.get(key)).then((result) => {
      if (!mounted.current) return
      const loaded = result.ok ? result.data : defaultSetting(key)
      // 읽어 오는 사이에 이미 바꾼 값이 있으면 그것을 지키지 않고 저장된 값으로 시작한다(처음 한 번뿐).
      latest.current = loaded
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

  const persist = useCallback(
    (next?: SettingsMap[K]) => {
      const toSave = next ?? latest.current
      if (toSave === null) return
      latest.current = toSave
      void window.octopus.settings.set(key, toSave)
    },
    [key]
  )

  return { value, setLocal, persist }
}
