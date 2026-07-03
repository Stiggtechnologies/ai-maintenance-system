/* eslint-disable @typescript-eslint/no-explicit-any */
import { Component, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Render a contained in-page card instead of a full-screen takeover. */
  inline?: boolean;
  /** When this value changes, the boundary resets (e.g. on route change). */
  resetKey?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidUpdate(prev: Props) {
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: undefined });
    }
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error("Error caught by boundary:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.inline) {
        return (
          <div className="p-6">
            <div className="bg-[#0D1520] border border-amber-500/20 rounded-2xl p-8 max-w-lg mx-auto text-center">
              <div className="w-14 h-14 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-7 h-7 text-amber-400" />
              </div>
              <h2 className="text-lg font-semibold text-[#E6EDF3] mb-2">
                This view hit an error
              </h2>
              <p className="text-sm text-slate-400 mb-2">
                The rest of SyncAI is still available — use the navigation to
                continue.
              </p>
              {this.state.error?.message && (
                <p className="text-[11px] text-slate-600 mb-5 font-mono break-words">
                  {this.state.error.message}
                </p>
              )}
              <button
                onClick={() => window.location.reload()}
                className="px-5 py-2.5 bg-teal-500/20 border border-teal-500/30 text-teal-400 text-sm font-medium rounded-lg hover:bg-teal-500/30 transition-colors"
              >
                Reload
              </button>
            </div>
          </div>
        );
      }
      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 p-4">
          <div className="bg-[#11161D] rounded-2xl shadow-xl p-8 max-w-md text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-red-600" />
            </div>
            <h1 className="text-2xl font-bold text-[#E6EDF3] mb-2">
              Something went wrong
            </h1>
            <p className="text-slate-400 mb-6">
              We encountered an unexpected error. Please try refreshing the
              page.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-lg transition-colors"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
