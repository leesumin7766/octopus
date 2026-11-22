// 외부 의존 없는 ULID. 시간 순으로 정렬되고, 같은 밀리초 안에서도 단조 증가한다.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32
const TIME_LENGTH = 10
const RANDOM_LENGTH = 16
const MAX_TIME = 2 ** 48 - 1

export type RandomFill = (bytes: Uint8Array<ArrayBuffer>) => void
export type UlidGenerator = (timeMs: number) => string

function encodeTime(timeMs: number): string {
  let out = ''
  let rest = timeMs
  for (let i = 0; i < TIME_LENGTH; i++) {
    out = ALPHABET[rest % 32] + out
    rest = Math.floor(rest / 32)
  }
  return out
}

/**
 * ULID 생성기. 호출마다 시각(ms)을 받는다(내부에서 시계를 읽지 않음).
 * 같은 ms 이거나 시계가 뒤로 가면 직전 값에서 1 만 올려 순서를 지킨다.
 */
export function createUlidGenerator(
  fill: RandomFill = (bytes) => {
    globalThis.crypto.getRandomValues(bytes)
  }
): UlidGenerator {
  let lastTime = -1
  let digits: number[] = [] // 5비트 값 16개 (80비트)

  return (timeMs) => {
    if (!Number.isInteger(timeMs) || timeMs < 0 || timeMs > MAX_TIME) {
      throw new RangeError('ULID time must be an integer between 0 and 2^48-1')
    }

    if (timeMs > lastTime) {
      const bytes = new Uint8Array(RANDOM_LENGTH)
      fill(bytes)
      digits = Array.from(bytes, (byte) => byte & 31)
      lastTime = timeMs
    } else {
      let i = RANDOM_LENGTH - 1
      while (i >= 0 && digits[i] === 31) i--
      if (i < 0) throw new Error('ULID random part overflow')
      digits[i] += 1
      for (let j = i + 1; j < RANDOM_LENGTH; j++) digits[j] = 0
    }

    return encodeTime(lastTime) + digits.map((d) => ALPHABET[d]).join('')
  }
}
