// Runtime-agnostic base64 helpers — work in Node, browsers, React Native, and Electron.

/** Encode a string or Uint8Array to base64. */
export function toBase64(input: string | Uint8Array): string {
  if (typeof input === 'string') {
    if (typeof btoa === 'function') {
      const bytes = new TextEncoder().encode(input)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
      return btoa(binary)
    }
    return (globalThis as { Buffer?: { from: (s: string, e: string) => { toString: (e: string) => string } } }).Buffer!
      .from(input, 'utf8').toString('base64')
  }

  if (typeof btoa === 'function') {
    let binary = ''
    for (let i = 0; i < input.length; i++) binary += String.fromCharCode(input[i]!)
    return btoa(binary)
  }
  return (globalThis as { Buffer?: { from: (b: Uint8Array) => { toString: (e: string) => string } } }).Buffer!
    .from(input).toString('base64')
}

/** Decode a base64 string to Uint8Array. */
export function fromBase64(base64: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  }
  return new Uint8Array(
    (globalThis as { Buffer?: { from: (s: string, e: string) => Uint8Array } }).Buffer!.from(base64, 'base64'),
  )
}

/** Decode a base64-encoded UTF-8 string. Runtime-agnostic (no `Buffer` global). */
export function base64ToUtf8(base64: string): string {
  return new TextDecoder('utf-8').decode(fromBase64(base64))
}
