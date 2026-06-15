var blake2 = require('blake2');
export function hash(str: string) {
  const hash = blake2.createHash('blake2s')
  hash.update(Buffer.from(str))
  const hashHex = hash.digest('hex')

  return hashHex
}
