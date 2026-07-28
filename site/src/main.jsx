import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Exploration switcher: ?v=mono / ?v=ark flips the token set (tokens.css
// variant blocks) and ?art=a|b|c|d swaps the hero painting, so directions can
// be compared live in the browser. No params = default set.
const params = new URLSearchParams(location.search);
const variant = params.get('v');
if (variant) document.documentElement.dataset.theme = variant;
const art = params.get('art');
if (art) document.documentElement.style.setProperty('--hero-art', `url("/cand-${art}.webp")`);

createRoot(document.getElementById('root')).render(<App />);
