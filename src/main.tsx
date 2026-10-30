import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { AuthProvider } from './context/AuthContext.tsx';
import { LanguageProvider } from './context/LanguageContext.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { checkApiHealth } from './utils/api.ts';

void Promise.resolve()
  .then(checkApiHealth)
  .then((healthy) => {
    if (!healthy) console.warn('Worker API health check failed');
  })
  .catch(() => {
    console.warn('Worker API health check failed');
  });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* 根级兜底：任意一处渲染抛错时给出可操作的界面，而不是整页白屏。
        放在 Provider 外面，连 Provider 初始化失败也能接住。 */}
    <ErrorBoundary fallbackTitle="豆织星格加载遇到错误" reloadOnReset>
      <AuthProvider>
        <LanguageProvider>
          <App />
        </LanguageProvider>
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
);
