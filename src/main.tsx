import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiFailure } from './api/problems';
import { AuthProvider } from './auth/AuthProvider';
import { App } from './App';
import './ui/app.css';

const queries = new QueryClient({
  defaultOptions: {
    queries: {
      // A refusal is a decision the server made and will make again. Retrying
      // a 403 three times turns "you do not have the role" into a four-second
      // wait before the same sentence.
      retry: (attempt, error) =>
        !(error instanceof ApiFailure && error.status < 500) && attempt < 2,
      staleTime: 10_000,
    },
    mutations: {
      // Never. A mutation here moves money, and the idempotency key is minted
      // per call — an automatic retry would mint a second one and make a
      // second posting.
      retry: false,
    },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('Falta #root en index.html.');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queries}>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
