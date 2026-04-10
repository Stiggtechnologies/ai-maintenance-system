import { Component, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
  correlationId?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class AgentErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    const correlationId = this.props.correlationId || "unknown";
    console.error(
      `event=agent_ui_error correlation_id=${correlationId} error=${error.message}`,
    );
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-center gap-2 text-red-700 mb-2">
            <AlertTriangle size={16} />
            <span className="font-medium text-sm">Assessment Error</span>
          </div>
          <p className="text-sm text-red-600">
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          {this.props.correlationId && (
            <p className="text-xs text-red-400 mt-1 font-mono">
              Correlation: {this.props.correlationId}
            </p>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
