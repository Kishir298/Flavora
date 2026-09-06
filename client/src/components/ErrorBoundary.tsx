import React from "react";

interface State {
  hasError: boolean;
  message: string;
}

/** Root error boundary (§14): one broken component never blanks the whole page. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(err: unknown): State {
    return { hasError: true, message: err instanceof Error ? err.message : String(err) };
  }

  componentDidCatch(err: unknown) {
    console.error("[flavora] ErrorBoundary caught:", err);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 max-w-lg mx-auto" role="alert">
          <h1 className="text-xl font-bold">Something broke, but your data is safe.</h1>
          <p className="mt-2 text-sm opacity-80">{this.state.message}</p>
          <button
            className="mt-4 px-4 py-2 rounded bg-green-600 text-white"
            onClick={() => this.setState({ hasError: false, message: "" })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
