import { describe, expect, test } from 'bun:test'
import { convertRsaPrivateKeyToPkcs8Pem } from '../worker/pkcs8'

const pemBodyAsHex = (pem: string): string => {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')
  return Uint8Array.from(atob(body), (character) => character.charCodeAt(0)).toHex()
}

describe('GitHub App private key conversion', () => {
  test('wraps a PKCS#1 RSA key in a PKCS#8 PrivateKeyInfo structure', () => {
    const converted = convertRsaPrivateKeyToPkcs8Pem(
      '-----BEGIN RSA PRIVATE KEY-----\\nAQID\\n-----END RSA PRIVATE KEY-----'
    )

    expect(converted).toStartWith('-----BEGIN PRIVATE KEY-----\n')
    expect(pemBodyAsHex(converted)).toBe('3017020100300d06092a864886f70d01010105000403010203')
  })

  test('leaves an existing PKCS#8 key in place', () => {
    expect(
      convertRsaPrivateKeyToPkcs8Pem('-----BEGIN PRIVATE KEY-----\nAQID\n-----END PRIVATE KEY-----')
    ).toBe('-----BEGIN PRIVATE KEY-----\nAQID\n-----END PRIVATE KEY-----\n')
  })
})
