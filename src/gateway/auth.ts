// Ed25519 device identity for OpenClaw Gateway authentication

const DB_NAME = 'clavus-device'
const STORE_NAME = 'keys'
const KEY_ID = 'device-keypair'

interface StoredKeypair {
  publicKey: JsonWebKey
  privateKey: JsonWebKey
  fingerprint: string
}

// Open IndexedDB for key storage (more secure than localStorage)
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function storeKeypair(data: StoredKeypair): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(data, KEY_ID)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function loadKeypair(): Promise<StoredKeypair | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(KEY_ID)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
}

// Generate fingerprint from public key (SHA-256 of raw bytes, hex-encoded)
async function fingerprint(publicKey: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey('raw', publicKey)
  const hash = await crypto.subtle.digest('SHA-256', exported)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Base64url encode
function b64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Base64url decode
function b64urlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - str.length % 4) % 4)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export interface DeviceIdentity {
  id: string
  publicKey: string // base64url-encoded raw public key
  sign: (data: Uint8Array<ArrayBuffer>) => Promise<string> // returns base64url signature
}

// Get or create Ed25519 device identity
export async function getDeviceIdentity(): Promise<DeviceIdentity> {
  const stored = await loadKeypair()

  if (stored) {
    const privateKey = await crypto.subtle.importKey(
      'jwk', stored.privateKey,
      { name: 'Ed25519' }, false, ['sign']
    )
    const publicKey = await crypto.subtle.importKey(
      'jwk', stored.publicKey,
      { name: 'Ed25519' }, true, ['verify']
    )
    const rawPub = await crypto.subtle.exportKey('raw', publicKey)

    return {
      id: stored.fingerprint,
      publicKey: b64url(rawPub),
      sign: async (data) => {
        const sig = await crypto.subtle.sign('Ed25519', privateKey, data)
        return b64url(sig)
      },
    }
  }

  // Generate new keypair
  const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  const rawPub = await crypto.subtle.exportKey('raw', pair.publicKey)
  const fp = await fingerprint(pair.publicKey)

  // Store as JWK for persistence
  const pubJwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const privJwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  await storeKeypair({ publicKey: pubJwk, privateKey: privJwk, fingerprint: fp })

  // Re-import private key as non-extractable for use
  const privKey = await crypto.subtle.importKey(
    'jwk', privJwk, { name: 'Ed25519' }, false, ['sign']
  )

  return {
    id: fp,
    publicKey: b64url(rawPub),
    sign: async (data) => {
      const sig = await crypto.subtle.sign('Ed25519', privKey, data)
      return b64url(sig)
    },
  }
}

// Sign challenge nonce for gateway authentication
export async function signChallenge(
  device: DeviceIdentity,
  nonce: string,
): Promise<{ signature: string; signedAt: number }> {
  const signedAt = Math.floor(Date.now() / 1000)
  const encoder = new TextEncoder()
  const data = encoder.encode(`${nonce}:${signedAt}`) as Uint8Array<ArrayBuffer>
  const signature = await device.sign(data)
  return { signature, signedAt }
}
