import { Component, type ErrorInfo, type ReactNode } from 'react'

/** Keeps a render error from blanking the whole app; progress is in localStorage, so neither exit loses anything. */
export default class Crash extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('carve: render error:', error.message, info.componentStack)
  }
  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="grid h-full min-h-[240px] place-items-center p-6">
        <div className="max-w-lg rounded-md border border-line bg-panel p-6">
          <h1 className="text-lg font-semibold">Something went wrong on this screen</h1>
          <p className="mt-2 text-sm text-mute">Continue clears the error and renders this screen again, which is worth a try unless the screen itself is what broke. Reload restarts the app. Either way your tagged evidence and hints are saved.</p>
          <pre className="mt-4 overflow-auto rounded border border-line bg-bg p-3 font-mono text-xs text-bad">{String(error.message || error)}</pre>
          <div className="mt-4 flex gap-2">
            <button onClick={() => this.setState({ error: null })} className="rounded-md bg-amber px-4 py-2 text-sm font-semibold text-bg">
              Continue
            </button>
            <button onClick={() => location.reload()} className="rounded-md border border-line px-4 py-2 text-sm text-mute hover:text-ink">
              Reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}
