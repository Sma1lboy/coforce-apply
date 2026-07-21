import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

// Apply-flow dialog. Headless mode (consented in setup): the server spawns a
// local `claude -p` session that fills everything and stops before submit;
// this dialog streams the log, then the user confirms and the same session
// resumes to submit. Manual mode falls back to copy-the-command.

const Plane = () => (
  <svg viewBox="0 0 512 512" className="w-9 h-9">
    <path d="M168 300 L318 212 L262 344 L232 296 L200 322 L206 278 Z" fill="oklch(92.5% 0.011 95)" />
    <path d="M206 278 L318 212 L236 300 L233 318 Z" fill="oklch(80% 0.017 90)" />
  </svg>
);
const spring = { type: 'spring', stiffness: 260, damping: 22 };

const PLANE_POS = {
  queueing: '10%', working: '38%', awaiting_confirm: '62%',
  submitting: '78%', submitted: '88%', failed: '38%', error: '38%', manual: '86%',
};
const BANNER = {
  queueing: 'Boarding…', working: 'Claude is applying — autopilot on',
  awaiting_confirm: 'Holding short of submit — your call', submitting: 'Cleared for takeoff — submitting',
  submitted: 'Airborne — application submitted', failed: 'Hit turbulence', error: 'Hit turbulence',
  manual: 'Ready for takeoff',
};

function Step({ i, state, children }) {
  // state: done | active | todo
  return (
    <motion.div initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }}
      transition={{ ...spring, delay: 0.15 + i * 0.12 }} className="flex items-center gap-3">
      <span className={`grid place-items-center w-5 h-5 rounded-full text-[11px] shrink-0 ${
        state === 'done' ? 'bg-ok/20 text-ok border border-ok/50'
        : state === 'active' ? 'border border-accent text-accent'
        : 'bg-well text-dim border border-rule2'}`}>
        {state === 'done' ? '✓' : state === 'active' ? (
          <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.1, ease: 'linear' }}>◠</motion.span>
        ) : i + 1}
      </span>
      <span className={`text-[12.5px] ${state === 'todo' ? 'text-dim' : 'text-ink2'}`}>{children}</span>
    </motion.div>
  );
}

export default function ApplyDialog({ job, mode, onClose, onQueued }) {
  const [phase, setPhase] = useState('queueing');
  const [tail, setTail] = useState('');
  const [err, setErr] = useState('');
  const jobIdRef = useRef(null);
  const pollRef = useRef(null);
  const logRef = useRef(null);
  const command = job ? `claude "/apply ${job.url}"` : '';

  const stopPoll = () => { clearInterval(pollRef.current); pollRef.current = null; };

  useEffect(() => {
    if (!job) { stopPoll(); return; }
    setPhase('queueing'); setTail(''); setErr(''); jobIdRef.current = null;
    (async () => {
      try {
        const q = await fetch('/api/queue', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(job),
        });
        if (!q.ok && q.status !== 409) throw new Error(await q.text());
        onQueued?.();
        if (mode !== 'headless') {
          try { await navigator.clipboard.writeText(command); } catch {}
          setPhase('manual');
          return;
        }
        const r = await fetch('/api/apply', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: job.url }),
        });
        if (!r.ok) throw new Error(await r.text());
        jobIdRef.current = (await r.json()).id;
        setPhase('working');
        pollRef.current = setInterval(async () => {
          try {
            const s = await (await fetch(`/api/apply/${jobIdRef.current}`)).json();
            setTail(s.tail);
            if (s.status === 'awaiting_confirm') setPhase(p => (p === 'submitting' ? p : 'awaiting_confirm'));
            else if (s.status === 'submitted') { setPhase('submitted'); stopPoll(); onQueued?.(); }
            else if (s.status === 'failed' || s.status === 'error') { setPhase('failed'); stopPoll(); }
          } catch {}
        }, 2500);
      } catch (e) { setErr(String(e.message)); setPhase('error'); }
    })();
    return stopPoll;
  }, [job]);

  useEffect(() => { logRef.current?.scrollTo(0, 1e9); }, [tail]);

  const confirm = async () => {
    setPhase('submitting');
    await fetch(`/api/apply/${jobIdRef.current}/confirm`, { method: 'POST' }).catch(() => {});
  };
  const cancel = async () => {
    if (jobIdRef.current && !['submitted', 'failed', 'manual'].includes(phase))
      await fetch(`/api/apply/${jobIdRef.current}/cancel`, { method: 'POST' }).catch(() => {});
    onClose();
  };

  const headlessSteps = [
    ['Queued to tracker', phase === 'queueing' ? 'active' : 'done'],
    ['Claude fills the application (tailor → forms → uploads)',
      phase === 'working' ? 'active' : ['queueing'].includes(phase) ? 'todo' : 'done'],
    ['You review & confirm the final submit',
      phase === 'awaiting_confirm' ? 'active' : ['submitting', 'submitted'].includes(phase) ? 'done' : 'todo'],
    ['Submitted & tracked as applied',
      phase === 'submitting' ? 'active' : phase === 'submitted' ? 'done' : 'todo'],
  ];

  return (
    <AnimatePresence>
      {job && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-center bg-well/75"
          onClick={e => e.target === e.currentTarget && phase !== 'submitting' && cancel()}>
          <motion.div initial={{ opacity: 0, y: 28, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }} transition={spring}
            className="w-[560px] max-w-[calc(100vw-48px)] bg-paper2 border border-rule2 rounded-2xl overflow-hidden">
            {/* runway */}
            <div className="relative h-20 bg-well border-b border-rule overflow-hidden">
              <motion.div className="absolute top-1/2 -translate-y-1/2"
                animate={{ left: PLANE_POS[phase] || '38%', rotate: phase === 'submitted' ? 8 : 0 }}
                transition={{ type: 'spring', stiffness: 60, damping: 16 }}>
                <Plane />
              </motion.div>
              <motion.div className="absolute top-1/2 h-px bg-accent/40 left-0"
                animate={{ width: PLANE_POS[phase] || '38%' }} transition={{ duration: 0.8 }} />
              <div className="absolute bottom-2 left-4 font-display text-[11px] uppercase tracking-widest text-faint">
                {BANNER[phase] || ''}
              </div>
            </div>

            <div className="p-5">
              <div className="font-display font-semibold text-[15px] leading-snug">{job.role}</div>
              <div className="text-muted text-xs mt-0.5 mb-4">{job.company}{job.location ? ` · ${job.location}` : ''}</div>

              {phase === 'error' ? (
                <div className="text-bad text-xs whitespace-pre-wrap">{err}</div>
              ) : phase === 'manual' ? (
                <div className="flex flex-col gap-2.5">
                  <Step i={0} state="done">Queued to tracker — pending, history recorded</Step>
                  <Step i={1} state="done">Command copied to clipboard</Step>
                  <Step i={2} state="todo">Paste in Claude Code to run the full flow (enable headless apply in /setup to skip this step)</Step>
                  <code className="block mt-2 bg-well border border-rule rounded-lg px-3 py-2 text-[11.5px] text-accentsoft overflow-x-auto whitespace-nowrap">{command}</code>
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-2.5">
                    {headlessSteps.map(([label, st], i) => <Step key={i} i={i} state={st}>{label}</Step>)}
                  </div>
                  {tail && phase !== 'submitted' && (
                    <pre ref={logRef} className="mt-4 bg-well border border-rule rounded-lg p-3 text-[10.5px] leading-relaxed text-faint max-h-36 overflow-y-auto whitespace-pre-wrap">{tail}</pre>
                  )}
                  {phase === 'submitted' && (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring}
                      className="mt-4 text-ok text-[12.5px]">✓ Application submitted — moved to Applied on your board.</motion.div>
                  )}
                </>
              )}

              <div className="flex justify-end gap-2 mt-5">
                <a className="btn-ghost" href={job.url} target="_blank" rel="noreferrer">Open JD ↗</a>
                {phase === 'awaiting_confirm' && (
                  <motion.button initial={{ scale: 0.9 }} animate={{ scale: 1 }} transition={spring}
                    className="btn" onClick={confirm}>Confirm & submit ⏎</motion.button>
                )}
                <button className="btn-ghost" onClick={cancel}>
                  {['submitted', 'manual', 'failed', 'error'].includes(phase) ? 'Done' : 'Cancel'}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
