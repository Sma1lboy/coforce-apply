import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';

// Animated apply-flow dialog: queue → command copied → next steps.
// The paper plane is the brand beat; steps cascade in with springs.

const Plane = () => (
  <svg viewBox="0 0 512 512" className="w-9 h-9">
    <path d="M168 300 L318 212 L262 344 L232 296 L200 322 L206 278 Z" fill="oklch(92.5% 0.011 95)" />
    <path d="M206 278 L318 212 L236 300 L233 318 Z" fill="oklch(80% 0.017 90)" />
  </svg>
);

const spring = { type: 'spring', stiffness: 260, damping: 22 };

function Step({ i, done, children }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -18 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ ...spring, delay: 0.35 + i * 0.45 }}
      className="flex items-center gap-3"
    >
      <motion.span
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ ...spring, delay: 0.55 + i * 0.45 }}
        className={`grid place-items-center w-5 h-5 rounded-full text-[11px] ${
          done ? 'bg-ok/20 text-ok border border-ok/50' : 'bg-well text-dim border border-rule2'
        }`}
      >
        {done ? '✓' : i + 1}
      </motion.span>
      <span className="text-ink2 text-[12.5px]">{children}</span>
    </motion.div>
  );
}

export default function ApplyDialog({ job, onClose, onQueued }) {
  const [phase, setPhase] = useState('flying'); // flying → done | error
  const [result, setResult] = useState(null);
  const command = job ? `claude "/apply ${job.url}"` : '';

  useEffect(() => {
    if (!job) return;
    setPhase('flying');
    setResult(null);
    (async () => {
      try {
        const res = await fetch('/api/queue', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(job),
        });
        if (!res.ok && res.status !== 409) throw new Error(await res.text());
        try { await navigator.clipboard.writeText(command); } catch {}
        setResult(res.status === 409 ? 'already tracked' : 'queued');
        setPhase('done');
        onQueued?.();
      } catch (e) {
        setResult(String(e.message));
        setPhase('error');
      }
    })();
  }, [job]);

  return (
    <AnimatePresence>
      {job && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-center bg-well/75"
          onClick={e => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            initial={{ opacity: 0, y: 28, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={spring}
            className="w-[520px] max-w-[calc(100vw-48px)] bg-paper2 border border-rule2 rounded-2xl overflow-hidden"
          >
            {/* runway */}
            <div className="relative h-20 bg-well border-b border-rule overflow-hidden">
              <motion.div
                className="absolute top-1/2 -translate-y-1/2"
                initial={{ left: '-12%', rotate: -6 }}
                animate={phase === 'flying' ? { left: '42%', rotate: 0 } : { left: '86%', rotate: 4 }}
                transition={{ type: 'spring', stiffness: 60, damping: 16 }}
              >
                <Plane />
              </motion.div>
              <motion.div
                className="absolute top-1/2 h-px bg-accent/40"
                initial={{ left: 0, width: 0 }}
                animate={{ width: phase === 'flying' ? '40%' : '86%' }}
                transition={{ duration: 0.9 }}
              />
              <div className="absolute bottom-2 left-4 font-display text-[11px] uppercase tracking-widest text-faint">
                {phase === 'flying' ? 'Launching application…' : phase === 'error' ? 'Hit turbulence' : 'Ready for takeoff'}
              </div>
            </div>

            <div className="p-5">
              <div className="font-display font-semibold text-[15px] leading-snug">{job.role}</div>
              <div className="text-muted text-xs mt-0.5 mb-4">
                {job.company}{job.location ? ` · ${job.location}` : ''}
              </div>

              {phase === 'error' ? (
                <div className="text-bad text-xs">{result}</div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  <Step i={0} done={phase === 'done'}>
                    {result === 'already tracked' ? 'Already on your board (To Apply)' : 'Queued to tracker — pending, history recorded'}
                  </Step>
                  <Step i={1} done={phase === 'done'}>
                    Command copied to clipboard
                  </Step>
                  <Step i={2} done={false}>
                    Paste in Claude Code to run the full flow — tailor → fill → confirm
                  </Step>
                </div>
              )}

              <motion.code
                initial={{ opacity: 0 }}
                animate={{ opacity: phase === 'done' ? 1 : 0 }}
                transition={{ delay: 1.6 }}
                className="block mt-4 bg-well border border-rule rounded-lg px-3 py-2 text-[11.5px] text-accentsoft overflow-x-auto whitespace-nowrap"
              >
                {command}
              </motion.code>

              <div className="flex justify-end gap-2 mt-5">
                <a className="btn-ghost" href={job.url} target="_blank" rel="noreferrer">Open JD ↗</a>
                <button className="btn" onClick={onClose}>Done</button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
