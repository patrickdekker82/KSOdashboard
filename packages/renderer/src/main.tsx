import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App.tsx';
import './styles/app.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // De kern draait lokaal; opnieuw proberen heeft weinig zin en verbergt fouten.
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('Het element #root ontbreekt in index.html.');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
