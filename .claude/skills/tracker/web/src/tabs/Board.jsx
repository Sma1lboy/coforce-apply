import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { STATUS_COLUMNS } from '../lib/classify.js';

const spring = { type: 'spring', stiffness: 260, damping: 24 };

function Detail({ app, globalFiles, onClose }) {
  if (!app) return null;
  const info = [
    ['Company', app.company],
    ['Position', app.position],
    ['Tracked', (app.createdAt || '').slice(0, 10)],
    ['Updated', (app.updatedAt || '').slice(0, 10)],
  ].filter(([, v]) => v);
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center bg-well/75"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12 }}
        transition={spring}
        className="w-[680px] max-w-[calc(100vw-48px)] max-h-[82vh] flex flex-col bg-paper2 border border-rule2 rounded-2xl overflow-hidden"
      >
        <div className="flex items-start gap-3 px-5 py-4 border-b border-rule">
          <h3 className="font-display font-semibold text-base flex-1">{app.title}</h3>
          <span className="text-[11px] uppercase tracking-wide border border-rule2 text-muted rounded-full px-2.5 py-0.5">{app.status}</span>
          <button className="text-dim hover:text-ink cursor-pointer" onClick={onClose}>✕</button>
        </div>
        <div className="p-5 overflow-y-auto text-[12.5px]">
          <div className="h3 !mt-0">JD Link</div>
          <a className="text-accentsoft break-all hover:text-accent2" href={app.url} target="_blank" rel="noreferrer">{app.url}</a>
          <div className="h3">Saved Info</div>
          {info.map(([k, v]) => (
            <div key={k} className="text-ink2"><span className="text-faint">{k}:</span> {v}</div>
          ))}
          {app.notes && (<><div className="h3">Notes</div><div className="text-ink2 whitespace-pre-wrap">{app.notes}</div></>)}
          <div className="h3">Files</div>
          {(app._files?.length || globalFiles.length) ? (
            <div className="text-ink2">
              {(app._files || []).map(f => (
                <div key={f}>⌁ <a className="text-accentsoft hover:underline" href={`/files/${app.id}/${encodeURIComponent(f)}`} target="_blank" rel="noreferrer">{f}</a></div>
              ))}
              {globalFiles.map(f => (
                <div key={f}>⌁ <a className="text-accentsoft hover:underline" href={`/files/${encodeURIComponent(f)}`} target="_blank" rel="noreferrer">{f}</a> <span className="text-faint">(global)</span></div>
              ))}
            </div>
          ) : <span className="text-dim">No files yet</span>}
          <div className="h3">History</div>
          {app.history?.length ? (
            <ul className="border-l border-rule2 ml-1">
              {app.history.map((h, i) => (
                <li key={i} className="relative pl-4 pb-3">
                  <span className="absolute -left-1 top-1.5 w-2 h-2 rounded-full bg-accent" />
                  <span className="block text-[11px] text-dim">{(h.date || '').replace('T', ' ').slice(0, 16)}</span>
                  <span className="text-ink2">{h.event}</span>
                </li>
              ))}
            </ul>
          ) : <span className="text-dim">No events recorded yet</span>}
          <div className="h3">Description</div>
          {app.description
            ? <div className="bg-well border border-rule rounded-lg p-3 whitespace-pre-wrap max-h-60 overflow-y-auto text-ink2">{app.description}</div>
            : <span className="text-dim">No description saved</span>}
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function Board({ state, onChanged }) {
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);
  const [detail, setDetail] = useState(null);
  const apps = state.apps;

  const drop = async status => {
    setOver(null);
    const app = apps.find(a => a.id === dragId);
    if (!app || app.status === status) return;
    const now = new Date().toISOString();
    const updated = apps.map(a =>
      a.id === dragId
        ? { ...a, status, updatedAt: now, history: [...(a.history || []), { date: now, event: `status: ${a.status} → ${status} (board)` }] }
        : a
    );
    await api.saveApps(updated.map(({ _files, ...rest }) => rest)).catch(() => {});
    onChanged();
  };

  return (
    <div className="flex-1 min-h-0 flex gap-3.5 p-5 overflow-x-auto items-stretch">
      {STATUS_COLUMNS.map(([status, label, color]) => (
        <section
          key={status}
          onDragOver={e => { e.preventDefault(); setOver(status); }}
          onDragLeave={() => setOver(o => (o === status ? null : o))}
          onDrop={() => drop(status)}
          className={`flex flex-col min-h-0 flex-1 min-w-[240px] bg-paper2 border rounded-xl p-3 transition-colors ${
            over === status ? 'border-accent bg-paper3' : 'border-rule'
          }`}
        >
          <h2 className="font-display text-[11px] font-semibold uppercase tracking-widest text-ink2 pb-2 mb-2.5 border-b-2 shrink-0" style={{ borderColor: color }}>
            {label}
            <span className="float-right font-body" style={{ color }}>{apps.filter(a => a.status === status).length}</span>
          </h2>
          <div className="flex-1 min-h-10 overflow-y-auto">
            <AnimatePresence initial={false}>
              {apps.filter(a => a.status === status).map(a => (
                <motion.div
                  key={a.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  draggable
                  onDragStart={() => setDragId(a.id)}
                  onClick={() => setDetail(a)}
                  className={`bg-paper3 border border-rule rounded-lg px-3 py-2.5 mb-2.5 cursor-grab hover:border-accent transition-colors ${
                    dragId === a.id ? 'opacity-50' : ''
                  }`}
                >
                  <div className="text-accentsoft font-medium break-words">{a.title}</div>
                  {(a.company || a.position) && (
                    <div className="text-xs text-muted mt-0.5">{[a.company, a.position].filter(Boolean).join(' · ')}</div>
                  )}
                  {a.needsFallback && a.status === 'pending' && (
                    <div className="inline-block mt-1.5 text-[11px] text-accentsoft bg-accent/12 border border-accent rounded-full px-2 py-px">⚑ needs Claude fallback</div>
                  )}
                  {a.notes && <div className="text-xs text-faint border-l-2 border-rule2 pl-2 mt-1.5 line-clamp-3 whitespace-pre-wrap">{a.notes}</div>}
                  <div className="text-[11px] text-dim mt-2">{(a.updatedAt || '').slice(0, 10)}</div>
                </motion.div>
              ))}
            </AnimatePresence>
            {!apps.some(a => a.status === status) && <div className="text-dim text-center py-2.5">—</div>}
          </div>
        </section>
      ))}
      <AnimatePresence>{detail && <Detail app={detail} globalFiles={state.globalFiles} onClose={() => setDetail(null)} />}</AnimatePresence>
    </div>
  );
}
