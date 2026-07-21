import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { api } from '../lib/api.js';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const STATUS = {
  queued: ['Queued', 'text-faint border-rule2'],
  needs_browser_jd: ['Needs Chrome', 'text-warn border-warn/50'],
  jd_ready: ['JD ready', 'text-info border-info/50'],
  matched: ['Matched', 'text-info border-info/50'],
  rendered: ['Ready to review', 'text-accentsoft border-accent'],
  revision_requested: ['Revision requested', 'text-warn border-warn/50'],
  render_failed: ['Render failed', 'text-bad border-bad/50'],
  approved: ['Approved', 'text-ok border-ok/50'],
};

const statusFor = (value, approvalMode) => {
  if (value === 'approved' && approvalMode === 'automatic') return ['Auto-approved', 'text-ok border-ok/50'];
  return STATUS[value] || [value || 'Unknown', 'text-faint border-rule2'];
};
const experienceLabel = experience => {
  if (experience.status === 'ready') return `${experience.counts?.entries || 0} experiences · ${experience.counts?.tags || 0} tags`;
  if (experience.status === 'profile_changed') return 'profile changed · run $experience build';
  if (experience.status === 'evidence_changed') return 'cached evidence changed · run $experience build';
  if (experience.status === 'sources_changed') return 'repo/author scope changed · run $experience refresh';
  if (experience.status === 'invalid') return 'invalid index · run $experience status';
  return 'missing · run $experience refresh';
};

function PdfPreview({ url, zoom }) {
  const canvasRef = useRef(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let loadingTask;
    let renderTask;
    const render = async () => {
      setLoading(true);
      setError('');
      try {
        loadingTask = getDocument(url.split('#')[0]);
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);
        if (cancelled) return;
        const scale = 1.32 * (zoom / 100);
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const context = canvas.getContext('2d', { alpha: false });
        renderTask = page.render({
          canvasContext: context,
          viewport,
          transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0],
          background: '#ffffff',
        });
        await renderTask.promise;
      } catch (reason) {
        if (!cancelled && reason?.name !== 'RenderingCancelledException') setError(String(reason?.message || reason));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    render();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      loadingTask?.destroy();
    };
  }, [url, zoom]);

  return (
    <div className="relative bg-white shadow-2xl min-h-80 min-w-60">
      <canvas ref={canvasRef} className="block" />
      {loading && <div className="absolute inset-0 grid place-items-center bg-white text-[11px] text-neutral-500">Rendering PDF…</div>}
      {error && <div className="absolute inset-0 grid place-items-center bg-white text-center text-[11px] text-red-700 p-8">PDF preview failed: {error}</div>}
    </div>
  );
}

function EmptyReview({ onSync, busy, experience }) {
  return (
    <div className="flex-1 grid place-items-center p-8">
      <div className="max-w-md text-center">
        <div className="text-accent text-3xl mb-4">◇</div>
        <h2 className="font-display text-lg font-semibold">No resume dossiers yet</h2>
        <p className="text-muted text-xs leading-5 mt-2">
          Queue a listing from Discover, or sync existing pending applications into this campaign.
        </p>
        <p className={`text-[11px] mt-3 ${experience.status === 'ready' ? 'text-ok' : 'text-warn'}`}>
          Tier 0 · {experienceLabel(experience)}
        </p>
        <button className="btn mt-5" disabled={busy} onClick={onSync}>{busy ? 'Syncing…' : 'Sync pending jobs'}</button>
      </div>
    </div>
  );
}

export default function Review({ state, onChanged }) {
  const campaign = state.campaign || { jobs: [], allApproved: false };
  const experience = state.experience || { status: 'missing', counts: {} };
  const reviewRequired = campaign.reviewRequired !== false;
  const [selectedId, setSelectedId] = useState(campaign.jobs[0]?.id || null);
  const [feedback, setFeedback] = useState('');
  const [zoom, setZoom] = useState(100);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const selected = campaign.jobs.find(job => job.id === selectedId) || campaign.jobs[0] || null;

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);
  useEffect(() => { setFeedback(''); setZoom(100); }, [selected?.id]);

  const counts = useMemo(() => ({
    approved: campaign.jobs.filter(job => job.status === 'approved').length,
    review: campaign.jobs.filter(job => job.status === 'rendered').length,
    blocked: campaign.jobs.filter(job => ['needs_browser_jd', 'render_failed'].includes(job.status)).length,
  }), [campaign.jobs]);

  const run = async (label, action) => {
    setBusy(label);
    setMessage('');
    try {
      const result = await action();
      await onChanged();
      return result;
    } catch (error) {
      setMessage(String(error.message));
      return null;
    } finally {
      setBusy('');
    }
  };

  const submitFeedback = async () => {
    if (!feedback.trim()) return;
    const result = await run('feedback', () => api.campaignFeedback(selected.id, feedback));
    if (result) {
      setFeedback('');
      setMessage('Revision request saved. The next $start cycle will rebuild this resume.');
    }
  };

  const approve = async () => {
    const result = await run('approve', () => api.approveCampaignJob(selected.id));
    if (result) setMessage('Resume approved.');
  };

  const exportAll = async () => {
    const result = await run('export', api.exportCampaign);
    if (result?.url) window.location.assign(result.url);
  };

  if (!campaign.jobs.length) {
    return <EmptyReview experience={experience} busy={busy === 'sync'} onSync={() => run('sync', api.syncCampaign)} />;
  }

  const [statusLabel, statusClass] = statusFor(selected.status, selected.approvalMode);
  const pdfUrl = `/campaign/files/jobs/${encodeURIComponent(selected.folder)}/resume.pdf#toolbar=0&navpanes=0&view=FitH`;
  const matchUrl = `/campaign/files/jobs/${encodeURIComponent(selected.folder)}/match-report.md`;
  const jdUrl = `/campaign/files/jobs/${encodeURIComponent(selected.folder)}/job-description.md`;
  const hasPdf = !!selected.artifacts?.['resume.pdf'];
  const evidence = selected.match?.evidence || [];

  return (
    <div className="review-shell flex-1 min-h-0 grid bg-well">
      <aside className="min-h-0 flex flex-col border-r border-rule bg-paper2">
        <div className="px-4 py-3.5 border-b border-rule">
          <div className="font-display text-[11px] uppercase tracking-[0.18em] text-accent">Resume campaign</div>
          <div className={`text-[10px] mt-1.5 ${experience.status === 'ready' ? 'text-ok' : 'text-warn'}`}>
            Tier 0 · {experienceLabel(experience)}
          </div>
          <div className="flex gap-3 text-[10px] text-faint mt-2">
            <span><b className="text-ok">{counts.approved}</b> approved</span>
            <span><b className="text-accentsoft">{counts.review}</b> review</span>
            <span><b className="text-warn">{counts.blocked}</b> blocked</span>
          </div>
          <div className="text-[9px] text-dim mt-2">{reviewRequired ? 'Manual review required' : 'Auto-approve + auto-export enabled'}</div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-2.5">
          {campaign.jobs.map((job, index) => {
            const [label, klass] = statusFor(job.status, job.approvalMode);
            return (
              <button
                key={job.id}
                onClick={() => setSelectedId(job.id)}
                className={`w-full text-left border rounded-lg px-3 py-2.5 mb-2 cursor-pointer transition-colors ${
                  selected.id === job.id ? 'bg-accent/10 border-accent' : 'bg-paper3 border-rule hover:border-rule2'
                }`}
              >
                <div className="flex gap-2 items-start">
                  <span className="text-[10px] text-dim mt-0.5">{String(index + 1).padStart(2, '0')}</span>
                  <span className="min-w-0">
                    <span className="font-display text-[12.5px] text-ink block truncate">{job.company}</span>
                    <span className="text-[11px] text-muted block mt-0.5 line-clamp-2">{job.role}</span>
                    <span className={`inline-block mt-2 border rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wide ${klass}`}>{label}</span>
                  </span>
                </div>
              </button>
            );
          })}
        </div>
        <div className="p-3 border-t border-rule">
          <button className="btn w-full disabled:opacity-40 disabled:cursor-not-allowed" disabled={!campaign.allApproved || busy === 'export'} onClick={exportAll}>
            {busy === 'export' ? 'Packing…' : 'Export approved ZIP'}
          </button>
          {!campaign.allApproved && <div className="text-[10px] text-dim text-center mt-2">Approve all {campaign.jobs.length} resumes to unlock</div>}
        </div>
      </aside>

      <section className="min-w-0 min-h-0 flex flex-col bg-[#11100f]">
        <div className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-rule bg-paper3">
          <span className="font-display text-xs text-ink2">PDF proof</span>
          <span className="h-4 w-px bg-rule2" />
          <button className="mini" onClick={() => setZoom(value => Math.max(70, value - 10))}>−</button>
          <span className="w-10 text-center text-[10px] text-faint">{zoom}%</span>
          <button className="mini" onClick={() => setZoom(value => Math.min(160, value + 10))}>+</button>
          {hasPdf && <a className="mini ml-auto" href={pdfUrl} target="_blank" rel="noreferrer">Open PDF ↗</a>}
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-6 grid place-items-start justify-center">
          {hasPdf ? (
            <PdfPreview url={pdfUrl} zoom={zoom} />
          ) : (
            <div className="w-[520px] max-w-full aspect-[8.5/11] border border-dashed border-rule2 bg-paper2 grid place-items-center text-center p-8">
              <div>
                <div className="font-display text-accentsoft">PDF not rendered yet</div>
                <div className="text-xs text-dim leading-5 mt-2">Status: {statusLabel}<br />Run the campaign cycle to fetch the JD, match evidence, and compile the template.</div>
              </div>
            </div>
          )}
        </div>
      </section>

      <aside className="min-h-0 overflow-y-auto border-l border-rule bg-paper2 p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-display text-base font-semibold leading-tight">{selected.company}</div>
            <div className="text-xs text-muted mt-1">{selected.role}</div>
          </div>
          <span className={`border rounded-full px-2 py-1 text-[9px] uppercase tracking-wide whitespace-nowrap ${statusClass}`}>{statusLabel}</span>
        </div>
        <a href={selected.url} target="_blank" rel="noreferrer" className="block text-[11px] text-accentsoft hover:underline break-all mt-3">View job posting ↗</a>

        <div className="h3">Match signal</div>
        <div className="flex items-end gap-2">
          <span className="font-display text-3xl text-accentsoft">{selected.matchScore ?? '—'}</span>
          <span className="text-[10px] text-dim mb-1">/ 100 keyword coverage</span>
        </div>
        <div className="h-1.5 bg-well rounded-full overflow-hidden mt-2"><div className="h-full bg-accent" style={{ width: `${selected.matchScore || 0}%` }} /></div>
        <div className="flex gap-2 mt-3">
          {selected.artifacts?.['job-description.md'] && <a className="mini" href={jdUrl} target="_blank" rel="noreferrer">JD</a>}
          {selected.artifacts?.['match-report.md'] && <a className="mini" href={matchUrl} target="_blank" rel="noreferrer">Full report</a>}
        </div>

        <div className="h3">Evidence shortlist</div>
        {evidence.length ? evidence.slice(0, 6).map(item => (
          <a key={item.id} href={item.url || '#'} target="_blank" rel="noreferrer" className="block border-l-2 border-rule2 hover:border-accent pl-2.5 py-1.5 mb-1.5 group">
            <span className="text-[11px] text-ink2 group-hover:text-accentsoft line-clamp-2">{item.title}</span>
            <span className="text-[9px] text-dim mt-1 block">{item.projectId} · {(item.matched || []).slice(0, 4).join(' · ')}</span>
          </a>
        )) : <div className="text-[11px] text-dim">Evidence appears after JD matching.</div>}

        <div className="h3">Review notes</div>
        {!reviewRequired && <div className="text-[10px] text-dim mb-2">Auto mode is enabled. Turn “Require resume review” on in Settings if the next revision should wait for manual approval.</div>}
        <AnimatePresence initial={false}>
          {(selected.feedback || []).map(item => (
            <motion.div key={item.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="bg-well border border-rule rounded-lg p-2.5 mb-2">
              <div className="text-[11px] text-ink2 whitespace-pre-wrap">{item.text}</div>
              <div className="text-[9px] text-dim mt-1.5">{item.status} · {(item.createdAt || '').slice(0, 16).replace('T', ' ')}</div>
            </motion.div>
          ))}
        </AnimatePresence>
        <textarea className="inp min-h-24 resize-y" value={feedback} onChange={event => setFeedback(event.target.value)} placeholder="e.g. Emphasize the infra work; shorten project 2; keep the metrics exactly as sourced…" />
        <button className="btn-ghost w-full mt-2 disabled:opacity-40" disabled={!feedback.trim() || busy === 'feedback'} onClick={submitFeedback}>
          {busy === 'feedback' ? 'Saving…' : 'Request revision'}
        </button>

        {selected.error && <div className="mt-3 text-[11px] text-bad bg-bad/10 border border-bad/30 rounded-lg p-2.5">{selected.error}</div>}
        {message && <div className="mt-3 text-[11px] text-accentsoft bg-accent/10 border border-accent/30 rounded-lg p-2.5">{message}</div>}
        <button className="btn w-full mt-3 disabled:opacity-40 disabled:cursor-not-allowed" disabled={!hasPdf || !selected.artifacts?.['resume.tex'] || selected.status === 'approved' || busy === 'approve'} onClick={approve}>
          {selected.status === 'approved' ? 'Approved ✓' : busy === 'approve' ? 'Approving…' : 'Approve this resume'}
        </button>
      </aside>
    </div>
  );
}
