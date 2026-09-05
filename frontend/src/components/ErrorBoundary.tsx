import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  fallbackTitle?: string
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Caught render crash:', error, errorInfo)
    this.setState({ errorInfo })
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F7F7F8] flex flex-col items-center justify-center p-6 font-sans">
          <div className="w-full max-w-lg bg-white border border-[#E4E4E6] rounded-2xl p-8 shadow-xl flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#FEF2F2] border border-[#FECACA] flex items-center justify-center text-[#DC2626] mb-5">
              <AlertTriangle size={32} />
            </div>
            <h2 className="text-lg font-bold text-[#0F0F0F] mb-2">
              {this.props.fallbackTitle || 'Dashboard Interface Recovered'}
            </h2>
            <p className="text-xs text-[#6B6B6B] mb-6 max-w-md">
              A rendering exception occurred. The application caught the error to prevent corruption.
            </p>
            {this.state.error && (
              <div className="w-full bg-[#1A1A1A] text-[#E0E0E0] p-4 rounded-xl text-left font-mono text-[11px] overflow-x-auto mb-6 border border-white/10">
                <p className="text-red-400 font-bold mb-1">{this.state.error.name}: {this.state.error.message}</p>
                {this.state.errorInfo?.componentStack && (
                  <p className="text-gray-500 whitespace-pre-wrap">{this.state.errorInfo.componentStack.trim().split('\n').slice(0, 4).join('\n')}</p>
                )}
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={this.handleReload}
                className="px-5 py-2.5 rounded-xl bg-[#A4123F] hover:bg-[#850E32] text-white text-xs font-bold transition-all shadow-md flex items-center gap-2 cursor-pointer"
              >
                <RefreshCw size={14} /> Reload Page
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
