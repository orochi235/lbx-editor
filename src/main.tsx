import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@weasel-js/theme/tokens.css';
import '@weasel-js/theme/fonts.css';
// The published kit ships its component CSS as a file rather than injecting it
// from the bundle — building from weasel's source used to hide this, because
// Vite compiled the CSS modules along with everything else. Tokens first: the
// component styles read from them.
import '@weasel-js/ui/style.css';
import '@weasel-js/labkit/styles.css';
import { App } from './App';

const container = document.getElementById('root')!;
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
