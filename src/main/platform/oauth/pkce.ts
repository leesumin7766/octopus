import { createHash, randomBytes } from 'node:crypto'

// PKCE(RFC 7636) 와 state. 무작위 값은 모두 암호학적 난수(randomBytes)로 만든다.

/** code_verifier: base64url 48바이트 = 64자([A-Za-z0-9-_]). 허용 범위 43~128자 안. */
export function createVerifier(): string {
  return randomBytes(48).toString('base64url')
}

/** code_challenge = base64url(SHA-256(verifier)), 방식은 S256 */
export function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url')
}

/** 요청과 돌아온 응답을 묶는 state: 무작위 32바이트 */
export function createState(): string {
  return randomBytes(32).toString('base64url')
}
