import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { LEVELS, DIRS } from '../lib/classify.js';

const Chip = ({ sel, children, onClick }) => (
  <button
    onClick={onClick}
    className={`rounded-full border px-4 py-1.5 text-xs cursor-pointer transition-colors ${
      sel ? 'text-accentsoft bg-accent/12 border-accent' : 'text-muted bg-well border-rule2 hover:border-accent'
    }`}
  >
    {children}
  </button>
);

const Toggle = ({ on, onChange, label, hint }) => (
  <label className="flex items-start gap-3 py-2 cursor-pointer">
    <button
      onClick={e => { e.preventDefault(); onChange(!on); }}
      className={`w-9 h-5 rounded-full border relative transition-colors shrink-0 mt-0.5 ${
        on ? 'bg-accent/40 border-accent' : 'bg-well border-rule2'
      }`}
    >
      <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all ${
        on ? 'left-[18px] bg-accentsoft' : 'left-0.5 bg-dim'
      }`} />
    </button>
    <span>
      <span className="text-ink2 text-[12.5px]">{label}</span>
      {hint && <span className="block text-[11px] text-dim mt-0.5">{hint}</span>}
    </span>
  </label>
);

export default function Settings({ state, onChanged, goWizard }) {
  const [prefs, setPrefs] = useState(state.prefs || { level: 'any', directions: [] });
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(setConfig).catch(() => setConfig({}));
  }, []);

  const flash = msg => { setStatus(msg); setTimeout(() => setStatus(''), 2000); };
  const savePrefs = async next => {
    setPrefs(next);
    await api.savePrefs(next).catch(() => {});
    onChanged();
  };
  const saveConfig = async patch => {
    const next = { ...config, ...patch };
    setConfig(next);
    try {
      await fetch('/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
      onChanged();
      flash('Saved ✓');
    } catch { flash('Save failed'); }
  };

  const dirSet = new Set(prefs.directions || []);
  if (!config) return <div className="flex-1 grid place-items-center text-dim">loading…</div>;

  const sources = config.sources || [];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-6">
      <div className="max-w-[760px] mx-auto pb-10">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-semibold text-lg">Settings</h2>
          <span className="text-[11px] text-accentsoft">{status}</span>
        </div>

        <div className="h3">Discovery preferences</div>
        <div className="text-[11px] text-dim mb-2">What the Discover tab filters by default (~/.coforce/preferences.json)</div>
        <div className="flex gap-2 mb-3">
          {LEVELS.map(([k, label]) => (
            <Chip key={k} sel={prefs.level === k} onClick={() => savePrefs({ ...prefs, level: k })}>{label}</Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {DIRS.filter(([k]) => k !== 'general').map(([k, label]) => (
            <Chip key={k} sel={dirSet.has(k)} onClick={() => {
              const next = new Set(dirSet);
              next.has(k) ? next.delete(k) : next.add(k);
              const arr = [...next];
              savePrefs({ ...prefs, directions: arr.length ? [...arr.filter(x => x !== 'general'), 'general'] : [] });
            }}>{label}</Chip>
          ))}
        </div>
        <div className="flex gap-2 mt-3">
          <button className="btn-ghost" onClick={() => savePrefs({ level: 'any', directions: [] })}>Reset filters</button>
          <button className="btn-ghost" onClick={goWizard}>Re-run welcome wizard</button>
        </div>

        <div className="h3">Apply</div>
        <Toggle
          on={!!config.headlessApply}
          onChange={v => saveConfig({ headlessApply: v })}
          label="One-click headless apply"
          hint='The Apply button runs a local background Claude (claude -p --dangerously-skip-permissions) that fills everything and always stops for your confirmation before submitting. Off = copy-the-command flow.'
        />
        <Toggle
          on={!!config.autoRegister}
          onChange={v => saveConfig({ autoRegister: v })}
          label="Auto-register ATS accounts (Workday & co.)"
          hint="Passwords are generated locally and stored in macOS Keychain; account email below."
        />
        <div className="grid grid-cols-2 gap-3 mt-2">
          <label className="flex flex-col gap-1">
            <span className="flabel">Account email</span>
            <input className="inp" defaultValue={config.email ?? ''} onBlur={e => e.target.value !== (config.email ?? '') && saveConfig({ email: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="flabel">Resume PDF path</span>
            <input className="inp" defaultValue={config.resumePdf ?? ''} onBlur={e => e.target.value !== (config.resumePdf ?? '') && saveConfig({ resumePdf: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="flabel">Verification codes via</span>
            <select className="inp" value={config.mailboxAccess ?? 'paste'} onChange={e => saveConfig({ mailboxAccess: e.target.value })}>
              <option value="browser">browser (read my logged-in mailbox)</option>
              <option value="paste">paste (ask me each time)</option>
            </select>
          </label>
        </div>

        <div className="h3">Job sources</div>
        <div className="text-[11px] text-dim mb-2">GitHub job-list READMEs Discover fetches. Empty = built-in defaults (speedyapply · vanshb03 · jobright-ai).</div>
        {sources.map((s, i) => (
          <div key={i} className="flex gap-2 mb-2">
            <input className="inp !w-52" value={s.name} placeholder="name"
              onChange={e => saveConfig({ sources: sources.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} />
            <input className="inp flex-1" value={s.url} placeholder="https://raw.githubusercontent.com/…/README.md"
              onChange={e => saveConfig({ sources: sources.map((x, j) => j === i ? { ...x, url: e.target.value } : x) })} />
            <button className="mini" onClick={() => saveConfig({ sources: sources.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        <button className="mini" onClick={() => saveConfig({
          sources: [...sources, { name: '', url: '' }],
        })}>+ Add source</button>
        {!sources.length && (
          <button className="mini ml-2" onClick={() => saveConfig({
            sources: [
              { name: '2027-SWE-College-Jobs', url: 'https://raw.githubusercontent.com/speedyapply/2027-SWE-College-Jobs/main/README.md' },
              { name: 'Summer2027-Internships', url: 'https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/main/README.md' },
              { name: 'jobright-SWE-Internship', url: 'https://raw.githubusercontent.com/jobright-ai/2026-Software-Engineer-Internship/master/README.md' },
            ],
          })}>Copy defaults here to edit</button>
        )}
      </div>
    </div>
  );
}
