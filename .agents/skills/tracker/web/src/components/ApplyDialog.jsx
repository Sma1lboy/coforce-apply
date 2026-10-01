import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { APPLY_BANNER, applicationSteps } from '../lib/apply-feedback.js';

// Apply-flow dialog. Headless mode (consented in setup): the server spawns a
// local Claude session, which fills everything and stops before
// submit. This dialog streams the log, then the user confirms and the same
// session resumes to submit. Manual mode falls back to copy-the-command.

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
  const [queued, setQueued] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [copied, setCopied] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const closingRef = useRef(false);
  const confirmingRef = useRef(false);
  const jobIdRef = useRef(null);
  const pollRef = useRef(null);
  const logRef = useRef(null);
  const command = job ? `claude --chrome "/apply ${job.url}"` : '';

  const stopPoll = () => { clearInterval(pollRef.current); pollRef.current = null; };

  useEffect(() => {
    if (!job) { stopPoll(); return; }
    let disposed = false;
    let polling = false;
    closingRef.current = false;
    confirmingRef.current = false;
    setPhase('queueing'); setTail(''); setErr(''); setQueued(false); setPrepared(false);
    setCopied(false); setCancelling(false); jobIdRef.current = null;
    (async () => {
      try {
        const q = await fetch('/api/queue', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(job),
        });
        if (!q.ok && q.status !== 409) throw new Error(await q.text());
        if (disposed || closingRef.current) return;
        setQueued(true);
        onQueued?.();
        if (mode !== 'headless') {
          try {
            await navigator.clipboard.writeText(command);
            if (!disposed) setCopied(true);
          } catch { /* The visible command remains available for manual copying. */ }
          if (!disposed) setPhase('manual');
          return;
        }
        const r = await fetch('/api/apply', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: job.url }),
        });
        if (!r.ok) throw new Error(await r.text());
        const id = (await r.json()).id;
        if (disposed || closingRef.current) {
          // Closing while start is in flight must not leave an unseen run.
          await fetch(`/api/apply/${id}/cancel`, { method: 'POST' });
          return;
        }
        jobIdRef.current = id;
        setPhase('working');
        pollRef.current = setInterval(async () => {
          if (polling || disposed) return;
          polling = true;
          try {
            const response = await fetch(`/api/apply/${id}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const s = await response.json();
            if (disposed) return;
            setTail(s.tail || '');
            setErr('');
            if (s.status === 'awaiting_confirm') {
              setPrepared(true);
              if (!confirmingRef.current) setPhase('awaiting_confirm');
            } else if (s.status === 'submitted') {
              setPhase('submitted'); stopPoll(); onQueued?.();
            } else if (s.status === 'failed' || s.status === 'error') {
              setPhase('failed'); stopPoll();
            }
          } catch {
            if (!disposed) setErr('Cannot check application status. Keep this window open while we reconnect. Check the application site before trying another submission.');
          } finally { polling = false; }
        }, 2500);
      } catch (e) {
        if (!disposed) { setErr(String(e.message)); setPhase('error'); }
      }
    })();
    return () => { disposed = true; stopPoll(); };
  }, [job, mode]);

  useEffect(() => { logRef.current?.scrollTo(0, 1e9); }, [tail]);

  const confirm = async () => {
    if (confirmingRef.current) return;
    confirmingRef.current = true;
    setPhase('submitting');
    setErr('');
    try {
      const res = await fetch(`/api/apply/${jobIdRef.current}/confirm`, { method: 'POST' });
      if (!res.ok) {
        const detail = (await res.text()) || `HTTP ${res.status}`;
        if (res.status >= 400 && res.status < 500) {
          confirmingRef.current = false;
          setPhase('awaiting_confirm');
          setErr(`Could not confirm submission. ${detail} Check the application details, then try Confirm and submit again.`);
        } else {
          setErr('Submission status is uncertain. Keep this window open and check the application site before trying again.');
        }
      }
    } catch {
      // A lost response does not prove the server rejected the request.
      setErr('Submission status is uncertain. Keep this window open and check the application site before trying again.');
    }
  };
  const cancel = async () => {
    if (phase === 'submitting' || closingRef.current) return;
    closingRef.current = true;
    setCancelling(true);
    if (jobIdRef.current && !['submitted', 'failed', 'manual'].includes(phase)) {
      try {
        const response = await fetch(`/api/apply/${jobIdRef.current}/cancel`, { method: 'POST' });
        if (!response.ok) throw new Error();
      } catch {
        closingRef.current = false;
        setCancelling(false);
        setErr('Could not stop preparation. Keep this window open and try Stop preparation again.');
        return;
      }
    }
    stopPoll();
    onClose();
  };

  const headlessSteps = applicationSteps(phase, { queued, prepared });

  return (
    <AnimatePresence>
      {job && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-center bg-well/75"
          onClick={e => e.target === e.currentTarget && phase !== 'submitting' && cancel()}>
          <motion.div initial={{ opacity: 0, y: 28, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }} transition={spring}
            role="dialog" aria-modal="true" aria-label="Application progress"
            className="w-[560px] max-w-[calc(100vw-48px)] max-h-[90vh] overflow-y-auto bg-paper2 border border-rule2 rounded-2xl overflow-hidden">
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
                {APPLY_BANNER[phase] || ''}
              </div>
            </div>

            <div className="p-5">
              <div className="font-display font-semibold text-[15px] leading-snug">{job.role}</div>
              <div className="text-muted text-xs mt-0.5 mb-4">{job.company}{job.location ? ` · ${job.location}` : ''}</div>

              {phase === 'error' ? (
                <div role="alert" className="text-bad text-xs whitespace-pre-wrap">Could not start this application. Check the details below, then close this window and try again. {err}</div>
              ) : phase === 'manual' ? (
                <div className="flex flex-col gap-2.5">
                  <Step i={0} state="done">Added to your tracker. The application has not started.</Step>
                  <Step i={1} state={copied ? 'done' : 'todo'}>{copied ? 'Command copied to clipboard' : 'Could not copy automatically. Select and copy the command below.'}</Step>
                  <Step i={2} state="todo">Run the command in your terminal. Claude fills the form in Chrome and asks you to confirm before submitting.</Step>
                  <code className="block mt-2 bg-well border border-rule rounded-lg px-3 py-2 text-[11.5px] text-accentsoft overflow-x-auto whitespace-nowrap">{command}</code>
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-2.5">
                    {headlessSteps.map(([label, st], i) => <Step key={i} i={i} state={st}>{label}</Step>)}
                  </div>
                  {err && (
                    <div role="alert" className="mt-3 text-bad text-xs whitespace-pre-wrap">{err}</div>
                  )}
                  {phase === 'awaiting_confirm' && <p className="mt-3 text-xs text-muted">Review the form, resume, and answers in Chrome. Confirm and submit sends this application to {job.company}.</p>}
                  {phase === 'working' && <p className="mt-3 text-xs text-muted">Form entries and uploads may reach the application site now. You will confirm before final submission.</p>}
                  {phase === 'failed' && <p role="alert" className="mt-3 text-xs text-bad">The agent could not finish. Check the log and application site for the outcome before continuing manually.</p>}
                  {phase === 'submitting' && <p className="mt-3 text-xs text-muted">Waiting for confirmation from the application site. Do not submit again.</p>}
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
                <a className="btn-ghost" href={job.url} target="_blank" rel="noreferrer">Open job posting ↗</a>
                {phase === 'awaiting_confirm' && (
                  <motion.button initial={{ scale: 0.9 }} animate={{ scale: 1 }} transition={spring}
                    className="btn" onClick={confirm}>Confirm and submit</motion.button>
                )}
                <button className="btn-ghost" onClick={cancel} disabled={phase === 'submitting' || cancelling}>
                  {cancelling ? 'Stopping…' : ['submitted', 'manual', 'failed', 'error'].includes(phase) ? 'Close' : phase === 'submitting' ? 'Submitting…' : 'Stop preparation'}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
