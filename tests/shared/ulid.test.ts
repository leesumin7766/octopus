import { describe, expect, it } from 'vitest'
import { createUlidGenerator } from '../../src/shared/tasks/ulid'

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/

describe('createUlidGenerator', () => {
  it('produces 26 characters from the Crockford alphabet', () => {
    const ulid = createUlidGenerator()
    for (let i = 0; i < 50; i++) expect(ulid(1_700_000_000_000 + i)).toMatch(ULID_PATTERN)
  })

  it('sorts by time', () => {
    const ulid = createUlidGenerator()
    const ids = [1_000, 2_000, 3_000_000_000_000].map((t) => ulid(t))
    expect([...ids].sort()).toEqual(ids)
  })

  it('keeps ascending order for many ids in the same millisecond', () => {
    const ulid = createUlidGenerator()
    const ids = Array.from({ length: 2000 }, () => ulid(1_700_000_000_000))

    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual(ids)
  })

  it('keeps order when the clock goes backwards', () => {
    const ulid = createUlidGenerator()
    const first = ulid(5_000)
    const second = ulid(4_000)

    expect(second > first).toBe(true)
  })

  it('carries into the next digit when incrementing', () => {
    // 첫 호출의 난수: 마지막 자리만 31(Z), 나머지는 0
    const fill = (bytes: Uint8Array): void => {
      bytes.fill(0)
      bytes[bytes.length - 1] = 31
    }
    const ulid = createUlidGenerator(fill)
    const first = ulid(10)
    const second = ulid(10)

    expect(first.slice(10)).toBe('000000000000000Z')
    expect(second.slice(10)).toBe('0000000000000010')
  })

  it('rejects an invalid time', () => {
    const ulid = createUlidGenerator()

    expect(() => ulid(-1)).toThrow(RangeError)
    expect(() => ulid(1.5)).toThrow(RangeError)
    expect(() => ulid(2 ** 48)).toThrow(RangeError)
  })
})
