import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';

const spring = { type: 'spring', stiffness: 260, damping: 24 };
const clone = o => JSON.parse(JSON.stringify(o ?? {}));

/* ---------- resume-style preview ---------- */
function Preview({ p }) {
  if (!p || !Object.keys(p).length)
    return <div className="text-dim text-center my-auto">No profile yet — import a resume or fill the form →</div>;
  const contact = [p.email, p.phone, p.location, p.linkedin, p.github, p.website].filter(Boolean).join(' · ');
  const visibleSkills = [...new Set([
    ...(p.skills || []),
    ...(p.verifiedSkills || []).map(skill => skill.name),
  ].filter(Boolean))];
  const Bullets = ({ d }) => (
    <ul className="list-disc pl-4.5 mt-1 text-ink2 text-[12.5px]">
      {(d || []).map((b, i) => (
        <li key={i}>
          <div>{typeof b === 'string' ? b : b.text}</div>
          {typeof b === 'object' && b.textZh && <div className="text-muted text-[11px] mt-0.5">{b.textZh}</div>}
        </li>
      ))}
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
      {visibleSkills.length > 0 && (
        <><div className="h3">Skills</div>
          <div className="flex flex-wrap gap-1.5">
            {visibleSkills.map(s => <span key={s} className="text-[11px] text-ink2 bg-paper3 border border-rule2 rounded-full px-2.5 py-0.5">{s}</span>)}
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
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <textarea className="inp min-h-9 resize-y" rows={2} value={b.text}
              placeholder="English bullet"
              onChange={e => onChange(bullets.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
            <textarea className="inp min-h-9 resize-y text-[11px] text-muted" rows={2} value={b.textZh ?? ''}
              placeholder="中文翻译（可选）"
              onChange={e => onChange(bullets.map((x, j) => (j === i ? { ...x, textZh: e.target.value.trim() ? e.target.value : null } : x)))} />
          </div>
          <button className="mini" onClick={() => onChange(bullets.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <div className="flex justify-end mt-1.5">
        <button className="mini" onClick={() => onChange([...bullets, { text: '', textZh: null }])}>+ Bullet</button>
      </div>
    </>
  );
}

/* ---------- AI dialogs (full import + additive supplement) ---------- */
function AgentTextDialog({ open, onClose, agentName, title, blurb, placeholder, run, onDone }) {
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
            <h3 className="font-display font-semibold text-base mb-1">{title}</h3>
            <p className="text-[11px] text-dim mb-3">{blurb}</p>
            <textarea className="inp min-h-[260px] resize-y" spellCheck={false} placeholder={placeholder}
              value={text} onChange={e => setText(e.target.value)} />
            <div className="flex items-center justify-between mt-3 gap-3">
              <span className={`text-[11px] ${err ? 'text-bad' : 'text-accentsoft'}`}>
                {busy ? `${agentName} is working… (~30s)` : err}
              </span>
              <button className="btn" disabled={busy} onClick={async () => {
                if (!text.trim()) { setErr('Paste something first.'); return; }
                setBusy(true); setErr('');
                try {
                  onDone(await run(text));
                  setText('');
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

/* ---------- skill-policy review ---------- */
const policyShape = review => ({
  baseline: clone(review?.baseline || []),
  rolePacks: clone(review?.rolePacks || {}),
});

function SkillPolicyReview({ setProfile, onChanged, profileRevision }) {
  const [payload, setPayload] = useState(null);
  const [draft, setDraft] = useState(policyShape());
  const [newPack, setNewPack] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setPayload(null);
    setMessage(profileRevision ? '' : 'Save the profile to load its skill inventory.');
    if (!profileRevision) return () => { active = false; };
    api.skillPolicy()
      .then(next => {
        if (!active) return;
        setPayload(next);
        setDraft(policyShape(next.review));
      })
      .catch(error => active && setMessage(`Load failed: ${error.message}`));
    return () => { active = false; };
  }, [profileRevision]);

  const packNames = Object.keys(draft.rolePacks);
  const skills = payload?.skills || [];

  const toggleBaseline = name => setDraft(previous => {
    const present = previous.baseline.includes(name);
    return {
      baseline: present
        ? previous.baseline.filter(item => item !== name)
        : [...previous.baseline, name],
      rolePacks: present
        ? previous.rolePacks
        : Object.fromEntries(Object.entries(previous.rolePacks)
          .map(([pack, names]) => [pack, names.filter(item => item !== name)])),
    };
  });

  const togglePack = (pack, name) => setDraft(previous => {
    const current = previous.rolePacks[pack] || [];
    const present = current.includes(name);
    return {
      baseline: present
        ? previous.baseline
        : previous.baseline.filter(item => item !== name),
      rolePacks: {
        ...previous.rolePacks,
        [pack]: present
          ? current.filter(item => item !== name)
          : [...current, name],
      },
    };
  });

  const addPack = () => {
    const name = newPack.trim();
    if (!name) return;
    if (packNames.some(pack => pack.toLowerCase() === name.toLowerCase())) {
      setMessage('That role pack already exists.');
      return;
    }
    setDraft(previous => ({
      ...previous,
      rolePacks: { ...previous.rolePacks, [name]: [] },
    }));
    setNewPack('');
    setMessage('New pack added locally — assign skills before approval.');
  };

  const savePolicy = async approve => {
    if (approve && (!draft.baseline.length || !packNames.length ||
      packNames.some(pack => !draft.rolePacks[pack].length))) {
      setMessage('Approval needs a non-empty baseline and every visible role pack must contain skills.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const next = await api.saveSkillPolicy({ ...draft, approve });
      setPayload(next);
      setDraft(policyShape(next.review));
      setProfile(previous => ({ ...previous, resumeSkillPolicy: next.policy }));
      setMessage(approve ? 'Policy approved ✓' : 'Draft saved — review still required.');
      onChanged();
    } catch (error) {
      setMessage(`Save failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  };

  const persisted = policyShape(payload?.review);
  const dirty = JSON.stringify(draft) !== JSON.stringify(persisted);
  const canApprove = draft.baseline.length > 0 && packNames.length > 0 &&
    packNames.every(pack => draft.rolePacks[pack].length > 0);
  const displayedStatus = dirty ? 'unsaved draft' : payload?.review?.status;

  return (
    <section data-testid="skill-policy-review">
      <div className="h3 flex items-center justify-between">
        <span>Resume skill policy</span>
        {displayedStatus && (
          <span className={`text-[10px] uppercase tracking-[0.14em] ${
            displayedStatus === 'approved' ? 'text-ok' : 'text-warn'
          }`}>
            {displayedStatus.replace('_', ' ')}
          </span>
        )}
      </div>
      <div className="bg-paper3 border border-rule rounded-xl overflow-hidden">
        <div className="p-3 border-b border-rule">
          <div className="text-[11px] text-dim leading-relaxed">
            Baseline + one role pack are required. Other pool skills remain
            available for the Agent to select by JD relevance.
          </div>
        </div>

        <div className="p-3 border-b border-rule">
          <div className="flabel mb-1.5">Role packs</div>
          <div className="flex flex-wrap gap-1.5">
            {packNames.map(pack => (
              <span key={pack} className="inline-flex items-center gap-1.5 bg-paper2 border border-rule2 rounded-full px-2.5 py-1 text-[10px] text-ink2">
                {pack} <span className="text-accentsoft">{draft.rolePacks[pack].length}</span>
                <button
                  className="text-dim hover:text-bad cursor-pointer"
                  aria-label={`Remove ${pack} role pack`}
                  onClick={() => setDraft(previous => ({
                    ...previous,
                    rolePacks: Object.fromEntries(Object.entries(previous.rolePacks)
                      .filter(([name]) => name !== pack)),
                  }))}
                >✕</button>
              </span>
            ))}
            <div className="inline-flex">
              <input className="w-28 text-[10px] text-ink bg-well border border-rule2 rounded-l-full px-2.5 py-1 outline-none focus:border-accent"
                placeholder="new pack"
                value={newPack}
                onChange={event => setNewPack(event.target.value)}
                onKeyDown={event => event.key === 'Enter' && addPack()} />
              <button className="text-[10px] text-accentsoft bg-well border border-l-0 border-rule2 rounded-r-full px-2 cursor-pointer hover:text-ink"
                onClick={addPack}>+</button>
            </div>
          </div>
        </div>

      <div className="max-h-[390px] overflow-y-auto">
        {!payload && <div className="p-4 text-[11px] text-dim">Loading merged skill inventory…</div>}
        {payload && !skills.length && <div className="p-4 text-[11px] text-dim">No skills available.</div>}
        {skills.map(skill => {
            const inBaseline = draft.baseline.includes(skill.name);
            return (
              <div key={skill.id} className="px-3 py-2 border-b border-rule last:border-b-0">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-ink2 font-medium truncate">{skill.name}</div>
                    <div className="flex gap-1.5 items-center mt-0.5 text-[9px] text-faint">
                      <span className="truncate">{skill.category}</span>
                      {skill.attested && <span className="text-muted">resume</span>}
                      {skill.evidenceBacked && <span className="text-ok">evidence</span>}
                      {skill.source?.startsWith('http') && (
                        <a className="text-accentsoft hover:text-ink" href={skill.source} target="_blank" rel="noreferrer">source ↗</a>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1 max-w-[58%]">
                    <button className={`mini !px-2 !py-0.5 ${inBaseline ? '!border-accent !bg-accent/15 !text-ink' : ''}`}
                      aria-pressed={inBaseline}
                      onClick={() => toggleBaseline(skill.name)}>Base</button>
                    {packNames.map(pack => {
                      const active = draft.rolePacks[pack].includes(skill.name);
                      return (
                        <button key={pack}
                          className={`mini !px-2 !py-0.5 ${active ? '!border-accentsoft !bg-accent/10 !text-ink' : ''}`}
                          aria-pressed={active}
                          onClick={() => togglePack(pack, skill.name)}>{pack}</button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="p-3 border-t border-rule">
          <div className="min-h-4 text-[10px] text-dim mb-2">
            {message || (dirty ? 'Unsaved policy changes.' : payload?.review?.reasons?.join(' · '))}
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" disabled={busy || !dirty} onClick={() => savePolicy(false)}>
              {busy ? 'Saving…' : 'Save draft'}
            </button>
            <button className="btn" disabled={busy || !canApprove} onClick={() => savePolicy(true)}>
              Approve policy
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- main ---------- */
export default function Profile({ state, onChanged }) {
  const agentName = 'Claude';
  const [p, setP] = useState(clone(state.profile));
  const profileRevision = state.profile && Object.keys(state.profile).length
    ? JSON.stringify({
        skills: state.profile.skills || [],
        verifiedSkills: state.profile.verifiedSkills || [],
        resumeSkillPolicy: state.profile.resumeSkillPolicy || null,
      })
    : null;
  const [status, setStatus] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const set = patch => setP(prev => ({ ...prev, ...patch }));
  const setList = (key, fn) => setP(prev => ({ ...prev, [key]: fn(clone(prev[key] || [])) }));

  // Merge agent-proposed additions into the draft; nothing persists until Save.
  // verifiedAt is stamped here because the Save click IS the user's approval.
  const mergeAdditions = add => {
    const today = new Date().toISOString().slice(0, 10);
    const stamp = list => (list || []).map(e => ({
      ...e,
      ...(e.description ? { description: e.description.map(b => ({ ...b, verifiedAt: b.verifiedAt || today })) } : {}),
    }));
    let count = 0;
    setP(prev => {
      const next = clone(prev);
      for (const k of ['experience', 'projects', 'education', 'certifications']) {
        if (!add[k]?.length) continue;
        next[k] = [...(next[k] || []), ...stamp(add[k])];
        count += add[k].length;
      }
      if (add.skills?.length) {
        const have = new Set((next.skills || []).map(s => s.toLowerCase()));
        const fresh = add.skills.filter(s => !have.has(s.toLowerCase()));
        next.skills = [...(next.skills || []), ...fresh];
        count += fresh.length;
      }
      for (const s of add.customSections || []) {
        if (!s.entries?.length) continue;
        next.customSections = next.customSections || [];
        const hit = next.customSections.find(x => x.title?.toLowerCase() === s.title?.toLowerCase());
        if (hit) hit.entries = [...(hit.entries || []), ...stamp(s.entries)];
        else next.customSections.push({ ...s, entries: stamp(s.entries) });
        count += s.entries.length;
      }
      return next;
    });
    setStatus(count
      ? `Added ${count} ${count === 1 ? 'entry' : 'entries'}${add.notes ? ` — ${add.notes}` : ''} — review, then Save profile.`
      : add.notes || 'Nothing new to add.');
  };

  const save = async () => {
    const clean = clone(p);
    for (const k of ['experience', 'projects', 'education']) {
      clean[k] = (clean[k] || []).filter(e => Object.values(e).some(v => typeof v === 'string' && v.trim()));
      for (const e of clean[k]) if (e.description) e.description = e.description
        .filter(b => b.text?.trim())
        .map(b => ({ ...b, textZh: b.textZh?.trim() || null }));
      if (!clean[k].length) delete clean[k];
    }
    clean.customSections = (clean.customSections || [])
      .map(s => ({ ...s, entries: (s.entries || []).map(e => ({ ...e, description: (e.description || [])
        .filter(b => b.text?.trim())
        .map(b => ({ ...b, textZh: b.textZh?.trim() || null })) }))
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
          <button className="btn-ghost" onClick={() => setAddOpen(true)}>＋ Add with AI</button>
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
            <Field label="Chinese Resume Email" value={p.localizedContacts?.['zh-CN']?.email}
              onChange={v => set({ localizedContacts: { ...(p.localizedContacts || {}), 'zh-CN': { ...(p.localizedContacts?.['zh-CN'] || {}), email: v } } })} />
            <Field label="Chinese Resume Phone" value={p.localizedContacts?.['zh-CN']?.phone}
              onChange={v => set({ localizedContacts: { ...(p.localizedContacts || {}), 'zh-CN': { ...(p.localizedContacts?.['zh-CN'] || {}), phone: v } } })} />
            <Field label="Location" value={p.location} onChange={v => set({ location: v })} />
            <Field label="LinkedIn (handle)" value={p.linkedin} onChange={v => set({ linkedin: v })} />
            <Field label="GitHub (handle)" value={p.github} onChange={v => set({ github: v })} />
            <Field label="Website" value={p.website} onChange={v => set({ website: v })} />
            <label className="flex flex-col gap-1 col-span-2">
              <span className="flabel">Summary</span>
              <textarea className="inp resize-y" rows={3} value={p.summary ?? ''} onChange={e => set({ summary: e.target.value })} />
            </label>
          </div>
          <div className="h3">Resume &amp; coursework skills</div>
          <div className="text-[11px] text-dim mb-2">User-attested skills. Every item is eligible for JD matching even without public GitHub evidence.</div>
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
          <SkillPolicyReview
            setProfile={setP}
            onChanged={onChanged}
            profileRevision={profileRevision}
          />
          <div className="h3">Experience evidence enrichments</div>
          <div className="text-[11px] text-dim mb-2">Optional stronger provenance from Tier 0. These extend and enrich the resume inventory; they are not an eligibility gate.</div>
          <div className="flex flex-col gap-1.5">
            {(p.verifiedSkills || []).map((skill, i) => (
              <div key={`${skill.name}-${i}`} className="flex items-center gap-2 bg-paper3 border border-rule rounded-lg px-2.5 py-1.5">
                <span className="text-[12px] text-ink2 font-medium">{skill.name}</span>
                <span className="text-[10px] text-muted">{skill.category || 'Tools & Technologies'}</span>
                {skill.source && <a className="text-[10px] text-accentsoft truncate" href={skill.source} target="_blank" rel="noreferrer">source</a>}
                <span className="text-[10px] text-faint ml-auto">{skill.evidenceIds?.length || 0} evidence</span>
                <button className="mini" onClick={() => setList('verifiedSkills', list => list.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            {!p.verifiedSkills?.length && <div className="text-[11px] text-faint">Tier 0 experience skills will still join the campaign pool from the local experience index.</div>}
          </div>
          <SectionCards title="Experience" keyName="experience" addLabel="+ Add experience"
            empty={{ company: '', title: '', date: '', location: '', description: [{ text: '', textZh: null }] }}
            fields={[['Company', 'company'], ['Title', 'title'], ['Date', 'date'], ['Location', 'location']]} />
          <SectionCards title="Projects" keyName="projects" addLabel="+ Add project"
            empty={{ name: '', role: '', url: '', technologies: '', dateRange: '', description: [{ text: '', textZh: null }] }}
            fields={[['Name', 'name'], ['Role label', 'role'], ['Repository URL', 'url', true], ['Technologies', 'technologies'], ['Date range', 'dateRange']]} />
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
      <AgentTextDialog open={importOpen} onClose={() => setImportOpen(false)} agentName={agentName}
        title="Import resume with AI"
        blurb={`Paste resume text (PDF copy, LinkedIn, anything). Local headless ${agentName} parses it into a full profile — nothing saves until you review and hit Save profile.`}
        placeholder="Paste resume text here…"
        run={api.importResume}
        onDone={parsed => { setP(parsed); setStatus('Imported — review, then Save profile.'); }} />
      <AgentTextDialog open={addOpen} onClose={() => setAddOpen(false)} agentName={agentName}
        title="Add to profile with AI"
        blurb={`Drop anything new: a work-experience story in your own words, an award announcement (link + what you won), a certificate, a pasted LinkedIn section. ${agentName} structures it into new entries — existing content is untouched, and nothing saves until you review and hit Save profile.`}
        placeholder={'e.g. "Won 1st place at XYZ Hackathon 2025 among 200 teams — https://…/results" or "At Acme (2023–2024) I led the checkout rewrite that cut p99 latency 40%…"'}
        run={api.addToProfile}
        onDone={mergeAdditions} />
    </div>
  );
}
