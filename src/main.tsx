import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import AdminPage from './pages/AdminPage.tsx';
import './index.css';
import { AuthProvider } from './context/AuthContext.tsx';
import { LanguageProvider } from './context/LanguageContext.tsx';
import { checkApiHealth } from './utils/api.ts';

void checkApiHealth().then((healthy) => {
  if (!healthy) console.warn('Worker API health check failed');
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <LanguageProvider>
        {window.location.pathname === '/admin' ? <AdminPage /> : <App />}
      </LanguageProvider>
    </AuthProvider>
  </StrictMode>,
);
