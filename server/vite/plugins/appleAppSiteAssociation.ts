/**
 * Apple App Site Association (Universal Links).
 *
 * When the Clavus.app is signed with the `com.apple.developer.associated-domains`
 * entitlement and `applinks:openclaw.random-hamster.win`, macOS will route
 * HTTPS clicks to workspace-file URLs directly into the app instead of the
 * browser — covering links clicked from Slack, Mail, Notes, terminal, etc.
 *
 * Setup:
 *   1. Set CLAVUS_APPLE_TEAM_ID in your shell environment (10-character team
 *      identifier from developer.apple.com).
 *   2. Rebuild + re-sign the app so it picks up the new entitlement.
 *   3. Confirm the file is reachable at
 *      https://openclaw.random-hamster.win/.well-known/apple-app-site-association
 *
 * Until the team ID is configured the endpoint returns 404 (safe — Universal
 * Links remain inactive but every other deep-link path still works).
 */
export function appleAppSiteAssociationPlugin() {
  const BUNDLE_ID = 'win.random-hamster.clavus'
  const teamId = process.env.CLAVUS_APPLE_TEAM_ID || ''

  const attach = (server: any) => {
    server.middlewares.use((req: any, res: any, next: any) => {
      if (req.url !== '/.well-known/apple-app-site-association' && req.url !== '/apple-app-site-association') {
        return next()
      }
      if (!teamId) {
        res.statusCode = 404
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'CLAVUS_APPLE_TEAM_ID not configured' }))
        return
      }
      const aasa = {
        applinks: {
          apps: [],
          details: [
            {
              appIDs: [`${teamId}.${BUNDLE_ID}`],
              // Universal Links must be HTTPS path patterns. The hash route
              // is part of the URL fragment so we match the prefix that
              // generates these links in the openclaw-client.
              components: [
                { '/': '/*' },
              ],
            },
          ],
        },
      }
      res.statusCode = 200
      // Per Apple docs, AASA must be served as application/json (no .json
      // extension, no signing required on macOS 12+).
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'no-cache')
      res.end(JSON.stringify(aasa))
    })
  }

  return {
    name: 'apple-app-site-association',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}
