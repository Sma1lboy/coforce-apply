import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';

const spring = { type: 'spring', stiffness: 260, damping: 24 };
const clone = o => JSON.parse(JSON.stringify(o ?? {}));

/* ---------- resume-style preview ---------- */
function Preview({ p }) {
  if (!p || !Object.keys(p).length)
    return <div className="text-dim text-center my-auto">No profile yet — import a resume or fill the form →</div>;
  const contact = [p.email, p.phone, p.location, p.linkedin, p.github, p.website].filter(Boolean).join(' · ');
  const Bullets = ({ d }) => (
    <ul className="list-disc pl-4.5 mt-1 text-ink2 text-[12.5px]">
      {(d || []).map((b, i) => <li key={i}>{typeof b === 'string' ? b : b.text}</li>)}
    </ul>
  );
  const Entry = ({ head, date, sub, children }) => (
    <div className="mb-3">
      <div className="flex justify-between"><strong className="text-ink">{head}</strong><span className="text-dim text-xs">{date}</span></div>
      {sub && <div className="text-muted text-[12px]">{sub}</div>}
      {children}
    </div>
  );
  return (
    <div className="max-w-[640px]">
      <h2 className="font-display font-semibold text-2xl">{p.name}</h2>
      <div className="text-accentsoft mt-0.5">{p.title}</div>
      <div className="text-faint text-xs mt-1.5">{contact}</div>
      {p.summary && (<><div className="h3">Summary</div><p className="text-ink2 text-[12.5px]">{p.summary}</p></>)}
      {p.skills?.length > 0 && (
        <><div className="h3">Skills</div>
          <div className="flex flex-wrap gap-1.5">
            {p.skills.map(s => <span key={s} className="text-[11px] text-ink2 bg-paper3 border border-rule2 rounded-full px-2.5 py-0.5">{s}</span>)}
          </div></>
      )}
      {p.experience?.length > 0 && (
        <><div className="h3">Experience</div>
          {p.experience.map((e, i) => <Entry key={i} head={e.company} date={e.date} sub={e.title}><Bullets d={e.description} /></Entry>)}</>
      )}
      {p.projects?.length > 0 && (
        <><div className="h3">Projects</div>
          {p.projects.map((e, i) => <Entry key={i} head={e.name} date={e.dateRange} sub={e.technologies}><Bullets d={e.description} /></Entry>)}</>
      )}
      {p.education?.length > 0 && (
        <><div className="h3">Education</div>
          {p.education.map((e, i) => <Entry key={i} head={e.institution} date={e.date} sub={e.degree} />)}</>
      )}
      {(p.customSections || []).map((s, i) => (
        <React.Fragment key={i}>
          <div className="h3">{s.title}</div>
          {(s.entries || []).map((e, j) => <Entry key={j} head={e.heading} date={e.date} sub={e.subheading}>{e.description?.length ? <Bullets d={e.description} /> : null}</Entry>)}
        </React.Fragment>
      ))}
    </div>
  );
}

/* ---------- small form primitives ---------- */
const Field = ({ label, value, onChange, wide }) => (
  <label className={`flex flex-col gap-1 ${wide ? 'col-span-2' : ''}`}>
    <span className="flabel">{label}</span>
    <input className="inp" value={value ?? ''} onChange={e => onChange(e.target.value)} />
  </label>
);

function BulletList({ list, onChange }) {
  const bullets = list || [];
  return (
    <>
      {bullets.map((b, i) => (
        <div key={i} className="flex gap-1.5 mt-1.5 items-start">
          <textarea className="inp min-h-9 resize-y" rows={2} value={b.text}
            onChange={e => onChange(bullets.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
          <button className="mini" onClick={() => onChange(bullets.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <div className="flex justify-end mt-1.5">
        <button className="mini" onClick={() => onChange([...bullets, { text: '' }])}>+ Bullet</button>
      </div>
    </>
  );
}

/* ---------- AI import dialog ---------- */
function ImportDialog({ open, onClose, onImported }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-center bg-well/75"
          onClick={e => e.target === e.currentTarget && !busy && onClose()}>
          <motion.div initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12 }} transition={spring}
            className="w-[620px] max-w-[calc(100vw-48px)] bg-paper2 border border-rule2 rounded-2xl p-5">
            <h3 className="font-display font-semibold text-base mb-1">Import resume with AI</h3>
            <p className="text-[11px] text-dim mb-3">Paste resume text (PDF copy, LinkedIn, anything). Local headless {agentName} parses it — nothing saves until you review and hit Save profile.</p>
            <textarea className="inp min-h-[260px] resize-y" spellCheck={false} placeholder="Paste resume text here…"
              value={text} onChange={e => setText(e.target.value)} />
            <div className="flex items-center justify-between mt-3 gap-3">
              <span className={`text-[11px] ${err ? 'text-bad' : 'text-accentsoft'}`}>
                {busy ? `${agentName} is reading your resume… (~30s)` : err}
              </span>
              <button className="btn" disabled={busy} onClick={async () => {
                if (!text.trim()) { setErr('Paste some resume text first.'); return; }
                setBusy(true); setErr('');
                try {
                  const parsed = await api.importResume(text);
                  onImported(parsed);
                  onClose();
                } catch (e) { setErr(String(e.message)); } finally { setBusy(false); }
              }}>
                {busy ? '…' : `Parse with ${agentName}`}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------- main ---------- */
export default function Profile({ state, onChanged }) {
  const agentName = state.agent === 'codex' ? 'Codex' : 'Claude';
  const [p, setP] = useState(clone(state.profile));
  const [status, setStatus] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const set = patch => setP(prev => ({ ...prev, ...patch }));
  const setList = (key, fn) => setP(prev => ({ ...prev, [key]: fn(clone(prev[key] || [])) }));

  const save = async () => {
    const clean = clone(p);
    for (const k of ['experience', 'projects', 'education']) {
      clean[k] = (clean[k] || []).filter(e => Object.values(e).some(v => typeof v === 'string' && v.trim()));
      for (const e of clean[k]) if (e.description) e.description = e.description.filter(b => b.text?.trim());
      if (!clean[k].length) delete clean[k];
    }
    clean.customSections = (clean.customSections || [])
      .map(s => ({ ...s, entries: (s.entries || []).map(e => ({ ...e, description: (e.description || []).filter(b => b.text?.trim()) }))
        .filter(e => [e.heading, e.subheading, e.date].some(v => v?.trim()) || e.description.length) }))
      .filter(s => s.title?.trim() && s.entries.length);
    if (!clean.customSections.length) delete clean.customSections;
    for (const [k, v] of Object.entries(clean)) if (v === '' || v == null) delete clean[k];
    try {
      await api.saveProfile(clean);
      setStatus('Saved ✓');
      onChanged();
      setTimeout(() => setStatus(''), 2000);
    } catch (e) { setStatus(`Save failed: ${e.message}`); }
  };

  const SectionCards = ({ title, keyName, addLabel, empty, fields }) => (
    <>
      <div className="h3">{title}</div>
      {(p[keyName] || []).map((e, i) => (
        <div key={i} className="bg-paper3 border border-rule rounded-lg p-3 mb-2.5">
          <div className="grid grid-cols-2 gap-2.5 mb-1.5">
            {fields.map(([label, fk, wide]) => (
              <Field key={fk} label={label} wide={wide} value={e[fk]}
                onChange={v => setList(keyName, l => (l[i][fk] = v, l))} />
            ))}
          </div>
          {'description' in empty && (
            <BulletList list={e.description} onChange={d => setList(keyName, l => (l[i].description = d, l))} />
          )}
          <div className="flex justify-end mt-1.5">
            <button className="mini" onClick={() => setList(keyName, l => l.filter((_, j) => j !== i))}>Remove</button>
          </div>
        </div>
      ))}
      <button className="mini" onClick={() => setList(keyName, l => [...l, clone(empty)])}>{addLabel}</button>
    </>
  );

  return (
    <div className="flex-1 min-h-0 flex gap-4 p-5">
      <div className="flex-[1.2] min-w-0 overflow-y-auto bg-paper2 border border-rule rounded-xl p-7 flex flex-col">
        <Preview p={p} />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-2.5">
        <div className="flex items-center gap-2.5">
          <button className="btn-ghost" onClick={() => setImportOpen(true)}>⇪ Import resume (AI)</button>
          <span className="text-[11px] text-accentsoft flex-1 text-right">{status}</span>
          <button className="btn" onClick={save}>Save profile</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto pr-1.5">
          <div className="h3 !mt-0">Basics</div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Name" value={p.name} onChange={v => set({ name: v })} />
            <Field label="Title" value={p.title} onChange={v => set({ title: v })} />
            <Field label="Email" value={p.email} onChange={v => set({ email: v })} />
            <Field label="Phone" value={p.phone} onChange={v => set({ phone: v })} />
            <Field label="Location" value={p.location} onChange={v => set({ location: v })} />
            <Field label="LinkedIn (handle)" value={p.linkedin} onChange={v => set({ linkedin: v })} />
            <Field label="GitHub (handle)" value={p.github} onChange={v => set({ github: v })} />
            <Field label="Website" value={p.website} onChange={v => set({ website: v })} />
            <label className="flex flex-col gap-1 col-span-2">
              <span className="flabel">Summary</span>
              <textarea className="inp resize-y" rows={3} value={p.summary ?? ''} onChange={e => set({ summary: e.target.value })} />
            </label>
          </div>
          <div className="h3">Skills</div>
          <div className="flex flex-wrap gap-1.5 items-center">
            {(p.skills || []).map((s, i) => (
              <span key={`${s}-${i}`} className="inline-flex items-center gap-1.5 text-[11px] text-ink2 bg-paper3 border border-rule2 rounded-full px-2.5 py-0.5">
                {s}
                <button className="text-dim hover:text-accent2 cursor-pointer" onClick={() => setList('skills', l => l.filter((_, j) => j !== i))}>✕</button>
              </span>
            ))}
            <input className="w-32 text-xs text-ink bg-well border border-dashed border-rule2 rounded-full px-2.5 py-1 outline-none focus:border-accent"
              placeholder="+ add skill ⏎"
              onKeyDown={e => {
                if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                  const v = e.currentTarget.value.trim();
                  setList('skills', l => [...l, v]);
                  e.currentTarget.value = '';
                }
              }} />
          </div>
          <SectionCards title="Experience" keyName="experience" addLabel="+ Add experience"
            empty={{ company: '', title: '', date: '', location: '', description: [{ text: '' }] }}
            fields={[['Company', 'company'], ['Title', 'title'], ['Date', 'date'], ['Location', 'location']]} />
          <SectionCards title="Projects" keyName="projects" addLabel="+ Add project"
            empty={{ name: '', technologies: '', dateRange: '', description: [{ text: '' }] }}
            fields={[['Name', 'name'], ['Technologies', 'technologies'], ['Date range', 'dateRange', true]]} />
          <SectionCards title="Education" keyName="education" addLabel="+ Add education"
            empty={{ institution: '', degree: '', date: '', location: '' }}
            fields={[['Institution', 'institution'], ['Degree', 'degree'], ['Date', 'date'], ['Location', 'location']]} />

          <div className="h3">Custom sections</div>
          {(p.customSections || []).map((s, i) => (
            <div key={i} className="bg-paper3 border border-rule rounded-lg p-3 mb-2.5">
              <Field label="Section title (e.g. Awards, Publications)" wide value={s.title}
                onChange={v => setList('customSections', l => (l[i].title = v, l))} />
              {(s.entries || []).map((e, j) => (
                <div key={j} className="bg-paper2 border border-rule rounded-lg p-2.5 mt-2.5">
                  <div className="grid grid-cols-2 gap-2.5">
                    <Field label="Heading" value={e.heading} onChange={v => setList('customSections', l => (l[i].entries[j].heading = v, l))} />
                    <Field label="Date" value={e.date} onChange={v => setList('customSections', l => (l[i].entries[j].date = v, l))} />
                    <Field label="Subheading" wide value={e.subheading} onChange={v => setList('customSections', l => (l[i].entries[j].subheading = v, l))} />
                  </div>
                  <BulletList list={e.description} onChange={d => setList('customSections', l => (l[i].entries[j].description = d, l))} />
                  <div className="flex justify-end mt-1.5">
                    <button className="mini" onClick={() => setList('customSections', l => (l[i].entries = l[i].entries.filter((_, k) => k !== j), l))}>Remove entry</button>
                  </div>
                </div>
              ))}
              <div className="flex gap-1.5 justify-end mt-2">
                <button className="mini" onClick={() => setList('customSections', l => (l[i].entries = [...(l[i].entries || []), { heading: '', subheading: '', date: '', description: [] }], l))}>+ Entry</button>
                <button className="mini" onClick={() => setList('customSections', l => l.filter((_, j) => j !== i))}>Remove section</button>
              </div>
            </div>
          ))}
          <button className="mini mb-4" onClick={() => setList('customSections', l => [...l, { title: '', entries: [{ heading: '', subheading: '', date: '', description: [] }] }])}>
            + Add custom section
          </button>
        </div>
      </div>
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)}
        onImported={parsed => { setP(parsed); setStatus('Imported — review, then Save profile.'); }} />
    </div>
  );
}
