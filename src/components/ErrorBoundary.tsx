import { useState, useEffect, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

export function ErrorBoundary({ children, fallbackTitle }: Props) {
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const handleWindowError = (event: ErrorEvent) => {
      if (event.error) {
        setError(event.error);
      }
    };
    window.addEventListener('error', handleWindowError);
    return () => window.removeEventListener('error', handleWindowError);
  }, []);

  if (error) {
    return (
      <div className="p-6 bg-slate-900 text-slate-100 rounded-3xl border border-slate-800 shadow-2xl max-w-md mx-auto my-8 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center justify-center mx-auto">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-white">
          {fallbackTitle || '页面组件加载异常'}
        </h3>
        <p className="text-xs text-slate-400">
          {error.message || '遇到未知问题，点击重试恢复显示。'}
        </p>
        <button
          onClick={() => setError(null)}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 mx-auto transition-all cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>重新载入此界面</span>
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
