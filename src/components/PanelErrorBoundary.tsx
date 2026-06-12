import { Component, type ReactNode } from 'react'

/**
 * Containment for panel render/lazy-import failures.
 *
 * The Tauri WKWebView loading through the Cloudflare tunnel intermittently
 * fails dynamic module imports ("Importing a module script failed"). Without
 * a boundary, one failed lazy panel unmounts the entire React tree — the app
 * shows Home or a blank shell and stops responding until a full restart.
 * Here the failure stays inside the panel and offers an explicit recovery.
 */
export class PanelErrorBoundary extends Component<
  { children: ReactNode; label?: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error(`[Clavus] Panel crashed (${this.props.label || 'panel'}): ${error.message}`)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center gap-3 p-8">
        <p className="text-[14px] font-medium text-foreground/85">This view failed to load</p>
        <p className="text-[12px] text-muted-foreground max-w-[380px] text-center break-words">
          {this.state.error.message}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="inline-btn h-9 px-4 rounded-full glass text-[13px] font-medium text-foreground/85 hover:bg-foreground/[0.06] active:scale-95 transition-all"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => location.reload()}
            className="inline-btn h-9 px-4 rounded-full bg-primary text-primary-foreground text-[13px] font-medium hover:opacity-90 active:scale-95 transition-all"
          >
            Reload app
          </button>
        </div>
      </div>
    )
  }
}
