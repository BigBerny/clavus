/**
 * Dynamic-import with transparent retries.
 *
 * Chunk fetches occasionally fail transiently (cloudflared hiccup, Cloudflare
 * Access re-auth, brief dev-server restart). Without retries a single blip
 * throws into the error boundary and triggers a full recovery reload — the
 * "white flash". Retrying the import twice with backoff swallows the blip
 * invisibly; only a persistent failure escalates to the reload self-heal.
 */
export function importWithRetry<T>(factory: () => Promise<T>, retries = 2, delayMs = 1000): Promise<T> {
  return factory().catch((err: unknown) => {
    if (retries <= 0) throw err
    return new Promise<T>((resolve, reject) => {
      setTimeout(() => {
        importWithRetry(factory, retries - 1, delayMs * 2).then(resolve, reject)
      }, delayMs)
    })
  })
}
