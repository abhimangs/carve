import { Component, type ReactNode } from 'react'

/** Keeps a render error from blanking the whole app; progress is in localStorage, so "Continue" loses nothing. */
export default class Crash extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="grid h-full min-h-[240px] place-items-center p-6">
        <div className="max-w-lg rounded-md border border-line bg-panel p-6">
          <h1 className="text-lg font-semibold">Something went wrong on this screen</h1>
          <p className="mt-2 text-sm text-mute">Your tagged evidence and hints are saved. Press Continue; if you land on the home page, reopen the case and your progress is still there.</p>
          <pre className="mt-4 overflow-auto rounded border border-line bg-bg p-3 font-mono text-xs text-bad">{String(error.message || error)}</pre>
          <button onClick={() => this.setState({ error: null })} className="mt-4 rounded-md bg-amber px-4 py-2 text-sm font-semibold text-bg">
            Continue
          </button>
        </div>
      </div>
    )
  }
}
