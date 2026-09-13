const PKCS1_LABEL = 'RSA PRIVATE KEY'
const PKCS8_LABEL = 'PRIVATE KEY'

// rsaEncryption (1.2.840.113549.1.1.1) with the required NULL parameters.
const RSA_ALGORITHM_IDENTIFIER = Uint8Array.of(
  0x30,
  0x0d,
  0x06,
  0x09,
  0x2a,
  0x86,
  0x48,
  0x86,
  0xf7,
  0x0d,
  0x01,
  0x01,
  0x01,
  0x05,
  0x00
)

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

const encodeDerLength = (length: number): Uint8Array => {
  if (length < 0x80) return Uint8Array.of(length)

  const bytes: number[] = []
  let remaining = length
  while (remaining > 0) {
    bytes.unshift(remaining % 0x100)
    remaining = Math.floor(remaining / 0x100)
  }
  return Uint8Array.of(0x80 | bytes.length, ...bytes)
}

const encodeDerElement = (tag: number, value: Uint8Array): Uint8Array =>
  concatBytes(Uint8Array.of(tag), encodeDerLength(value.length), value)

const decodePem = (pem: string, label: string): Uint8Array => {
  const body = pem
    .replace(`-----BEGIN ${label}-----`, '')
    .replace(`-----END ${label}-----`, '')
    .replace(/\s/g, '')

  if (!body) throw new Error('GitHub App private key is empty')

  const binary = atob(body)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

const encodePem = (bytes: Uint8Array, label: string): string => {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8_192))
  }
  const lines = btoa(binary)
    .match(/.{1,64}/g)
    ?.join('\n')
  if (!lines) throw new Error('Could not encode the GitHub App private key')
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`
}

export const convertRsaPrivateKeyToPkcs8Pem = (value: string): string => {
  const pem = value.replace(/\\n/g, '\n').trim()
  if (pem.startsWith(`-----BEGIN ${PKCS8_LABEL}-----`)) return `${pem}\n`
  if (!pem.startsWith(`-----BEGIN ${PKCS1_LABEL}-----`)) {
    throw new Error('GitHub App private key must be an RSA or PKCS#8 PEM key')
  }

  const pkcs1Key = decodePem(pem, PKCS1_LABEL)
  const version = Uint8Array.of(0x02, 0x01, 0x00)
  const privateKey = encodeDerElement(0x04, pkcs1Key)
  const pkcs8Key = encodeDerElement(
    0x30,
    concatBytes(version, RSA_ALGORITHM_IDENTIFIER, privateKey)
  )

  return encodePem(pkcs8Key, PKCS8_LABEL)
}
