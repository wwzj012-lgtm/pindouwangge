import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { AuthProvider } from './context/AuthContext.tsx';
import { LanguageProvider } from './context/LanguageContext.tsx';
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
    <AuthProvider>
      <LanguageProvider>
        <App />
      </LanguageProvider>
    </AuthProvider>
  </StrictMode>,
);
