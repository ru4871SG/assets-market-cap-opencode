import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './i18n/config'
import './index.css'
import App from './App.tsx'
import { STRICT_MODE } from './config'

// Clear session storage on page load/refresh to reset to default state
// This ensures the app starts fresh on reload while preserving state during navigation
const SESSION_KEYS_TO_CLEAR = [
  'assets_search_query',
  'assets_added_from_search',
];

SESSION_KEYS_TO_CLEAR.forEach(key => {
  sessionStorage.removeItem(key);
});

// Conditionally wrap with StrictMode based on config
// See src/config.ts for details on what StrictMode does
const AppWithProviders = (
  <BrowserRouter>
    <App />
  </BrowserRouter>
);

createRoot(document.getElementById('root')!).render(
  STRICT_MODE ? (
    <StrictMode>
      {AppWithProviders}
    </StrictMode>
  ) : (
    AppWithProviders
  ),
)
