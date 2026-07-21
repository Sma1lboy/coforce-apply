import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { LEVELS, DIRS, levelOf, dirsOf, faviconFor } from '../lib/classify.js';
import ApplyDialog from '../components/ApplyDialog.jsx';

const spring = { type: 'spring', stiffness: 260, damping: 24 };

function PrefsWizard({ onSave }) {
  const [level, setLevel] = useState('any');
  const [dirs, setDirs] = useState([]);
  const toggle = k => setDirs(d => (d.includes(k) ? d.filter(x => x !== k) : [...d, k]));
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 grid place-items-center bg-well/75">
      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={spring}
        className="w-[560px] max-w-[calc(100vw-48px)] bg-paper2 border border-rule2 rounded-2xl p-6"
      >
        <h3 className="font-display font-semibold text-lg">Welcome 👋 — tune your discovery</h3>
        <div className="h3">What are you looking for?</div>
        <div className="flex gap-2">
          {LEVELS.map(([k, label], i) => (
            <motion.button
              key={k}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: 0.1 + i * 0.07 }}
              onClick={() => setLevel(k)}
              className={`rounded-full border px-4 py-1.5 text-xs cursor-pointer transition-colors ${
                level === k ? 'text-accentsoft bg-accent/12 border-accent' : 'text-muted bg-well border-rule2 hover:border-accent'
              }`}
            >
              {label}
            </motion.button>
          ))}
        </div>
        <div className="h3">Directions — pick any that fit</div>
        <div className="flex flex-wrap gap-2">
          {DIRS.filter(([k]) => k !== 'general').map(([k, label], i) => (
            <motion.button
              key={k}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: 0.25 + i * 0.05 }}
              onClick={() => toggle(k)}
              className={`rounded-full border px-4 py-1.5 text-xs cursor-pointer transition-colors ${
                dirs.includes(k) ? 'text-accentsoft bg-accent/12 border-accent' : 'text-muted bg-well border-rule2 hover:border-accent'
              }`}
            >
              {label}
            </motion.button>
          ))}
        </div>
        <div className="flex items-center justify-between mt-6 gap-4">
          <span className="text-[11px] text-dim">Saved locally to ~/.coforce/preferences.json — change anytime in the filter panel</span>
          <button className="btn" onClick={() => onSave({ level, directions: dirs.length ? [...dirs, 'general'] : [] })}>
            Start discovering →
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function Discover({ state, onChanged }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState(state.prefs?.level || 'any');
  const [dirs, setDirs] = useState(new Set(state.prefs?.directions || []));
  const [sources, setSources] = useState(new Set());
  const [q, setQ] = useState('');
  const [wizard, setWizard] = useState(
    !state.prefs || sessionStorage.getItem('coforce-wizard') === '1'
  );
  useEffect(() => { sessionStorage.removeItem('coforce-wizard'); }, []);
  const [applying, setApplying] = useState(null);

  const load = async () => {
    setBusy(true);
    setErr(null);
    try {
      const d = await api.discover();
      d.new = d.new.map(j => ({ ...j, _level: levelOf(j), _dirs: dirsOf(j) }));
      setData(d);
    } catch (e) {
      setErr(String(e.message));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { load(); }, []);

  const persistPrefs = (lv, ds) => api.savePrefs({ level: lv, directions: [...ds] }).catch(() => {});

  const jobs = data?.new || [];
  const dirCounts = useMemo(() => {
    const c = {};
    for (const j of jobs) for (const d of j._dirs) c[d] = (c[d] || 0) + 1;
    return c;
  }, [jobs]);
  const srcCounts = useMemo(() => {
    const c = {};
    for (const j of jobs) c[j.source] = (c[j.source] || 0) + 1;
    return c;
  }, [jobs]);

  const shown = jobs.filter(j => {
    if (level !== 'any' && j._level !== level) return false;
    if (dirs.size && !j._dirs.some(d => dirs.has(d))) return false;
    if (sources.size && !sources.has(j.source)) return false;
    if (q && !`${j.role} ${j.company} ${j.location || ''}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="flex-1 min-h-0 flex gap-4 p-5 max-w-[1240px] w-full mx-auto">
      {/* list */}
      <div className="flex-1 min-w-0 flex flex-col gap-2.5">
        <div className="flex items-center gap-3">
          <button className="btn-ghost" onClick={load} disabled={busy}>↻ Refresh sources</button>
          <span className="text-[11px] text-faint truncate">
            {busy ? 'Fetching job sources…' : err ? `Discovery failed: ${err}` :
              data ? `${shown.length} shown of ${jobs.length} new · ${data.skipped.tracked} tracked · ${data.skipped.blocked} never-apply` : ''}
          </span>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          <AnimatePresence initial={false}>
            {shown.map(j => (
              <motion.div
                key={j.url}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex items-center gap-3.5 bg-paper2 border border-rule rounded-lg px-3.5 py-2.5 mb-2 hover:border-rule2"
              >
                {faviconFor(j.homepage) && (
                  <img
                    src={faviconFor(j.homepage)}
                    alt=""
                    loading="lazy"
                    className="w-[26px] h-[26px] rounded-md bg-paper3 object-contain shrink-0"
                    onError={e => e.currentTarget.remove()}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <a href={j.url} target="_blank" rel="noreferrer" className="text-accentsoft font-medium hover:text-accent2 hover:underline break-words">
                    {j.role}
                  </a>
                  <div className="text-xs text-muted mt-0.5">
                    {j.company}{j.location ? ` · ${j.location}` : ''} · <span className="text-dim">{j.source}</span>
                  </div>
                </div>
                <button className="btn shrink-0" onClick={() => setApplying(j)}>Apply ⇢</button>
              </motion.div>
            ))}
          </AnimatePresence>
          {!busy && data && !shown.length && (
            <div className="text-dim text-center py-10">Nothing matches these filters — loosen them or ↻ refresh.</div>
          )}
        </div>
      </div>

      {/* filters */}
      <aside className="w-[235px] shrink-0 overflow-y-auto bg-paper2 border border-rule rounded-xl p-3.5 self-start max-h-full">
        <div className="h3 !mt-0">Search</div>
        <input className="inp" placeholder="role, company, city…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="h3">Level</div>
        {LEVELS.map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 py-1 text-ink2 text-xs cursor-pointer">
            <input type="radio" name="level" className="accent-(--color-accent)" checked={level === k}
              onChange={() => { setLevel(k); persistPrefs(k, dirs); }} />
            {label}
          </label>
        ))}
        <div className="h3">Direction</div>
        {DIRS.map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 py-1 text-ink2 text-xs cursor-pointer">
            <input type="checkbox" className="accent-(--color-accent)" checked={dirs.size === 0 || dirs.has(k)}
              onChange={() => {
                const next = new Set(dirs.size === 0 ? DIRS.map(([x]) => x) : dirs);
                next.has(k) ? next.delete(k) : next.add(k);
                const final = next.size === DIRS.length ? new Set() : next;
                setDirs(final);
                persistPrefs(level, final);
              }} />
            {label}
            <span className="ml-auto text-[11px] text-dim">{dirCounts[k] || 0}</span>
          </label>
        ))}
        <div className="h3">Source</div>
        {Object.keys(srcCounts).map(s => (
          <label key={s} className="flex items-center gap-2 py-1 text-ink2 text-xs cursor-pointer">
            <input type="checkbox" className="accent-(--color-accent)" checked={sources.size === 0 || sources.has(s)}
              onChange={() => {
                const all = Object.keys(srcCounts);
                const next = new Set(sources.size === 0 ? all : sources);
                next.has(s) ? next.delete(s) : next.add(s);
                setSources(next.size === all.length ? new Set() : next);
              }} />
            <span className="truncate">{s}</span>
            <span className="ml-auto text-[11px] text-dim">{srcCounts[s]}</span>
          </label>
        ))}
      </aside>

      {wizard && (
        <PrefsWizard
          onSave={p => {
            setLevel(p.level);
            setDirs(new Set(p.directions));
            api.savePrefs(p).catch(() => {});
            setWizard(false);
          }}
        />
      )}
      <ApplyDialog job={applying} mode={state.applyMode} onClose={() => setApplying(null)} onQueued={onChanged} />
    </div>
  );
}
