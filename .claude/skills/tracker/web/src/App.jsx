import React, { useEffect, useState, useCallback } from 'react';
import Discover from './tabs/Discover.jsx';
import Board from './tabs/Board.jsx';
import Profile from './tabs/Profile.jsx';
import Instructions from './tabs/Instructions.jsx';
import { api } from './lib/api.js';

const TABS = [
  ['discover', 'Discover'],
  ['profile', 'Profile'],
  ['board', 'Board'],
  ['instructions', 'Instructions'],
];

export default function App() {
  const initial = location.hash.slice(1);
  const [tab, setTab] = useState(TABS.some(([k]) => k === initial) ? initial : 'discover');
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      setState(await api.state());
    } catch (e) {
      setError(String(e.message));
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { location.hash = tab; }, [tab]);

  if (error)
    return <div className="h-full grid place-items-center text-bad">console API unreachable: {error}</div>;
  if (!state)
    return <div className="h-full grid place-items-center text-dim">loading…</div>;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="flex items-baseline gap-4 px-6 py-3.5 border-b border-rule bg-paper2 shrink-0">
        <h1 className="font-display font-semibold text-base tracking-tight">
          <span className="text-accent">◆ </span>CoForce
        </h1>
        <nav className="flex gap-1 ml-3">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`font-display text-[13px] font-medium rounded-lg px-3.5 py-1 border transition-colors cursor-pointer ${
                tab === k
                  ? 'text-accentsoft bg-accent/12 border-accent'
                  : 'text-muted border-transparent hover:text-ink2'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
        <span className="text-xs text-faint ml-auto">{state.apps.length} tracked</span>
      </header>
      <main className="flex-1 min-h-0 flex flex-col">
        {tab === 'discover' && <Discover state={state} onChanged={reload} />}
        {tab === 'board' && <Board state={state} onChanged={reload} />}
        {tab === 'profile' && <Profile state={state} onChanged={reload} />}
        {tab === 'instructions' && <Instructions state={state} onChanged={reload} />}
      </main>
    </div>
  );
}
