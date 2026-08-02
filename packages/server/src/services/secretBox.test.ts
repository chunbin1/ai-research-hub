import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isSecretBoxAvailable,
  encryptSecret,
  decryptSecret,
  keyHint,
  SecretBoxUnavailableError,
  SecretDecryptError,
} from './secretBox.ts'

const KEY_A = 'a'.repeat(64)
const KEY_B = 'b'.repeat(64)

function withKey(hex: string | undefined, fn: () => void): void {
  const prev = process.env.LLM_KEY_SECRET
  if (hex === undefined) delete process.env.LLM_KEY_SECRET
  else process.env.LLM_KEY_SECRET = hex
  try { fn() } finally {
    if (prev === undefined) delete process.env.LLM_KEY_SECRET
    else process.env.LLM_KEY_SECRET = prev
  }
}

test('isSecretBoxAvailable:合法 64 位 hex 才算可用', () => {
  withKey(KEY_A, () => assert.equal(isSecretBoxAvailable(), true))
  withKey(undefined, () => assert.equal(isSecretBoxAvailable(), false))
  withKey('', () => assert.equal(isSecretBoxAvailable(), false))
  withKey('a'.repeat(63), () => assert.equal(isSecretBoxAvailable(), false))
  withKey('z'.repeat(64), () => assert.equal(isSecretBoxAvailable(), false))
})

test('加解密往返', () => {
  withKey(KEY_A, () => {
    const blob = encryptSecret('sk-secret-value', 'usr_1')
    assert.notEqual(blob, 'sk-secret-value')
    assert.equal(decryptSecret(blob, 'usr_1'), 'sk-secret-value')
  })
})

test('同一明文两次加密产生不同密文(IV 随机)', () => {
  withKey(KEY_A, () => {
    assert.notEqual(encryptSecret('same', 'usr_1'), encryptSecret('same', 'usr_1'))
  })
})

test('AAD 不匹配时解不开', () => {
  withKey(KEY_A, () => {
    const blob = encryptSecret('sk-secret-value', 'usr_1')
    assert.throws(() => decryptSecret(blob, 'usr_2'), SecretDecryptError)
  })
})

test('密文被篡改时 authTag 校验失败', () => {
  withKey(KEY_A, () => {
    const blob = encryptSecret('sk-secret-value', 'usr_1')
    const raw = Buffer.from(blob, 'base64')
    raw[raw.length - 1] ^= 0xff
    assert.throws(() => decryptSecret(raw.toString('base64'), 'usr_1'), SecretDecryptError)
  })
})

test('换主密钥后旧密文解不开', () => {
  let blob = ''
  withKey(KEY_A, () => { blob = encryptSecret('sk-secret-value', 'usr_1') })
  withKey(KEY_B, () => {
    assert.throws(() => decryptSecret(blob, 'usr_1'), SecretDecryptError)
  })
})

test('密文过短时报 SecretDecryptError 而不是崩溃', () => {
  withKey(KEY_A, () => {
    assert.throws(() => decryptSecret('YWJj', 'usr_1'), SecretDecryptError)
  })
})

test('没配主密钥时加解密抛 SecretBoxUnavailableError', () => {
  withKey(undefined, () => {
    assert.throws(() => encryptSecret('x', 'usr_1'), SecretBoxUnavailableError)
    assert.throws(() => decryptSecret('x', 'usr_1'), SecretBoxUnavailableError)
  })
})

test('keyHint:长 key 露前 4 后 4,短 key 一个字符都不露', () => {
  assert.equal(keyHint('sk-abcdefghijkl'), 'sk-a……ijkl')
  assert.equal(keyHint('short'), '……')
  assert.equal(keyHint(''), '……')
})
