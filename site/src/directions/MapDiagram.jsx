/* Hallmark · macrostructure: Map / Diagram · genre: editorial · theme: custom (kobe Hallmark)
 * chapter order: proof → mechanism → control → aftermath → CTA. Show the running
 * product before explaining it; the diagram argues better once the reader has
 * seen what it produces.
 * type: Space Grotesk display (solid + stroked) · Newsreader text · JetBrains Mono for signal
 * motion: reveal, path-draw, carrier, ticker — all disabled under prefers-reduced-motion
 * contrast: pass · divider language: bleed-colour block + negative space, no card anywhere
 */
import { useState } from 'react';
import {
  product, install, firstRun, pipeline, supplyRail, demandRail, crossing, gate,
  lane, tracking, ironLaws, requirements, dataHome, shots,
} from '../content.js';
import { useInView } from '../useInView.js';

function Tag({ children, tone = 'dim', n }) {
  return (
    <span
      className="block font-body text-2xs font-medium uppercase tracking-[0.2em]"
      style={{ color: `var(--color-${tone})` }}
    >
      {n && <span style={{ color: 'var(--color-accent)' }}>{n} · </span>}
      {children}
    </span>
  );
}

// The install commands as they would sit in a terminal: shell lines under `$`,
// the first thing typed into Claude under `›`. Display splits the one-liner for
// readability; copy hands back the one-liner exactly, because the split is
// presentation and the command is the contract.
function InstallBlock() {
  const [copied, setCopied] = useState(false);
  const [cloneLine, ...runRest] = install.split(' && ');
  const copy = () => {
    navigator.clipboard?.writeText(install).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };
  return (
    <div
      className="cmd border-l-2 pl-[var(--space-sm)]"
      style={{ borderColor: 'var(--color-accent)' }}
    >
      <button
        type="button"
        className={copied ? 'cmd__copy cmd__copy--ok' : 'cmd__copy'}
        onClick={copy}
        aria-live="polite"
      >
        {copied ? 'copied' : 'copy'}
      </button>
      <pre className="m-0 overflow-x-auto font-body text-xs leading-[2]" style={{ color: 'var(--color-ink)' }}>
        <span className="cmd__prompt">$ </span>{cloneLine}{'\n'}
        <span className="cmd__prompt">$ </span>{runRest.join(' && ')}{'\n'}
        <span className="cmd__prompt">› </span>{firstRun.command}
      </pre>
    </div>
  );
}

function Rail({ rail }) {
  return (
    <div className="map__rail">
      <Tag tone="accent">{rail.label}</Tag>
      {rail.steps.map((step, i) => (
        <div
          key={step.node}
          className={`map__step rise${step.live ? ' map__step--live' : ''}`}
          style={{ '--i': i + 1 }}
        >
          <p
            className="m-0 font-display text-h3 leading-tight"
            style={{ color: step.live ? 'var(--color-ink)' : 'var(--color-ink-3)' }}
          >
            {step.node}
          </p>
          <p className="m-0 font-body text-xs" style={{ color: 'var(--color-faint)' }}>
            {step.note}
          </p>
        </div>
      ))}
    </div>
  );
}

export default function MapDiagram() {
  const [shotsRef, shotsIn] = useInView({ threshold: 0.12 });
  const [mapRef, mapIn] = useInView({ threshold: 0.08 });
  const [gateRef, gateIn] = useInView({ threshold: 0.3 });
  const [lawsRef, lawsIn] = useInView({ threshold: 0.12 });
  const [trackRef, trackIn] = useInView({ threshold: 0.25 });
  const [ctaRef, ctaIn] = useInView({ threshold: 0.3 });

  return (
    <main className="mx-auto max-w-[var(--page-max)] px-[var(--page-gutter)] pb-[var(--space-3xl)]">
      {/* The repo is the product's only address, so it gets a permanent seat in
          the top bar instead of hiding in the footer. */}
      <nav
        className="flex flex-wrap items-center justify-between gap-[var(--space-sm)] border-b py-[var(--space-sm)] font-body text-2xs font-medium uppercase tracking-[0.2em]"
        style={{ borderColor: 'var(--color-rule)' }}
        aria-label="Top"
      >
        <span style={{ color: 'var(--color-accent)' }}>◆ {product.name}</span>
        <span className="flex items-center gap-[var(--space-sm)]" style={{ color: 'var(--color-faint)' }}>
          <span>{product.license}</span>
          <a className="ghbtn" href={product.repo}>github ↗</a>
        </span>
      </nav>

      {/* isolate keeps the bloom's negative z-index inside the header instead of
          sliding under the page background. The headline runs the full page
          width — mega type needs the whole measure, or "on" ends up alone on a
          line — and the summary + install command share the row beneath it. */}
      <header className="relative isolate pt-[var(--space-xl)] pb-[var(--space-xl)]">
        <div className="bloom" aria-hidden="true" />
        {/* The tagline IS the headline — a stranger has five seconds, and
            "what does it do" beats wordplay. Two lines, same face, two
            registers: one solid, one drawn, and the drawn line stays drawn. */}
        <h1
          className="mt-[var(--space-sm)] text-mega leading-[0.86]"
          style={{ letterSpacing: '-0.04em' }}
        >
          <span className="intro block" style={{ '--i': 1 }}>Your job hunt</span>
          <span className="intro stroked block" style={{ '--i': 2 }}>on autopilot.</span>
        </h1>
        <div className="mt-[var(--space-lg)] grid gap-[var(--space-lg)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start">
          <p
            className="intro m-0 max-w-[46ch] font-text text-read-lg leading-[1.5]"
            style={{ color: 'var(--color-ink-2)', '--i': 3 }}
          >
            {product.summary}
          </p>
          <div className="intro min-w-0" style={{ '--i': 4 }}>
            <InstallBlock />
          </div>
        </div>
      </header>

      {/* The operating cycle in four commands — the concrete answer to "what
          does this thing actually do", before any diagram. */}
      <div
        className="grid grid-cols-2 gap-x-[var(--space-lg)] gap-y-[var(--space-md)] border-t pt-[var(--space-md)] pb-[var(--space-lg)] lg:grid-cols-4"
        style={{ borderColor: 'var(--color-rule)' }}
      >
        {pipeline.map((step, i) => (
          <div key={step.verb} className="intro min-w-0" style={{ '--i': i + 5 }}>
            <p className="m-0 font-display text-h3 leading-tight">
              {step.verb}
              {i < pipeline.length - 1 && (
                <span aria-hidden="true" style={{ color: 'var(--color-accent)' }}> →</span>
              )}
            </p>
            <p className="m-0 mt-[2px] font-body text-xs" style={{ color: 'var(--color-accent-soft)' }}>
              {step.cmd}
            </p>
            <p className="m-0 mt-[var(--space-2xs)] font-body text-xs leading-relaxed" style={{ color: 'var(--color-faint)' }}>
              {step.note}
            </p>
          </div>
        ))}
      </div>

      {/* 01 · Proof before mechanism: the real console and a real PDF, both off
          the repo's own sandbox. Real captures, fixture data, no painted-on
          browser chrome. */}
      <section
        ref={shotsRef}
        className={`border-t pt-[var(--space-lg)]${shotsIn ? ' is-in' : ''}`}
        style={{ borderColor: 'var(--color-rule)' }}
      >
        <Tag n="01">this is the actual thing running</Tag>

        {/* The board is a wide strip and the resume is a tall page — side by side
            in one row, the short column left a dead third of the fold empty. The
            strip takes its own row; the page sits beside its caption. */}
        <figure className="rise m-0 mt-[var(--space-md)]" style={{ '--i': 1 }}>
          <h3 className="font-display text-h3 leading-snug">{shots[0].title}</h3>
          <img
            src={shots[0].src}
            alt={shots[0].alt}
            loading="lazy"
            decoding="async"
            className="shot mt-[var(--space-xs)] block h-auto w-full border"
            style={{ borderColor: 'var(--color-rule-2)', borderRadius: 'var(--radius-card)' }}
          />
          <figcaption
            className="mt-[var(--space-2xs)] max-w-[86ch] font-body text-xs leading-relaxed"
            style={{ color: 'var(--color-faint)' }}
          >
            {shots[0].caption}
          </figcaption>
        </figure>

        {/* items-center, not items-end: the page is much taller than its caption,
            and bottom-aligning the text left the top half of the column dead. */}
        <figure
          className="rise m-0 mt-[var(--space-xl)] grid gap-[var(--space-lg)] lg:grid-cols-[minmax(0,0.58fr)_minmax(0,1fr)] lg:items-center"
          style={{ '--i': 2 }}
        >
          <img
            src={shots[1].src}
            alt={shots[1].alt}
            loading="lazy"
            decoding="async"
            className="shot block h-auto w-full border"
            style={{ borderColor: 'var(--color-rule-2)', borderRadius: 'var(--radius-card)' }}
          />
          <div className="min-w-0">
            <h3 className="font-display text-h2 leading-tight">{shots[1].title}</h3>
            <figcaption
              className="mt-[var(--space-sm)] font-text text-read leading-[1.55]"
              style={{ color: 'var(--color-ink-2)' }}
            >
              {shots[1].caption}
            </figcaption>
          </div>
        </figure>
      </section>

      {/* 02 · The mechanism. Two rails converge on one node; the only edge out
          runs through the pool the user approved. The layout is the argument. */}
      <section
        aria-label="How a resume gets built"
        ref={mapRef}
        className={`mt-[var(--space-2xl)] border-t pt-[var(--space-lg)]${mapIn ? ' is-in' : ''}`}
        style={{ borderColor: 'var(--color-rule)' }}
      >
        <Tag n="02">how a resume gets built</Tag>
        <div className="map mt-[var(--space-md)]">
          <Rail rail={supplyRail} />
          <div aria-hidden="true" />
          <Rail rail={demandRail} />

          {/* A wide viewBox keeps the x/y scale factors close to each other at
              desktop widths, so the curves keep their shape. A 100-unit box
              stretched across 1400px flattens them into unreadable arcs. */}
          <svg
            className="map__converge"
            viewBox="0 0 1200 110"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path d="M 40 0 C 40 72, 600 30, 600 110" />
            <path d="M 1160 0 C 1160 72, 600 30, 600 110" />
            <circle cx="600" cy="92" r="4.5" />
          </svg>

          <div className="map__cross band">
            <div className="grid gap-[var(--space-md)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center">
              <div className="min-w-0">
                <Tag tone="accent-2">the only crossing</Tag>
                <p
                  className="rise m-0 font-display text-display leading-[0.95]"
                  style={{ letterSpacing: '-0.03em' }}
                >
                  {crossing.node}
                </p>
              </div>
              <p
                className="rise m-0 font-text text-read leading-[1.6]"
                style={{ color: 'var(--color-ink)', '--i': 2 }}
              >
                {crossing.claim}
              </p>
            </div>

            <ol className="mt-[var(--space-lg)] grid list-none gap-[var(--space-md)] p-0 sm:grid-cols-3">
              {crossing.out.map((item, i) => (
                <li key={item.step} className="rise min-w-0" style={{ '--i': i + 3 }}>
                  <p className="m-0 font-display text-lg font-semibold" style={{ color: 'var(--color-ink)' }}>
                    {item.step}
                  </p>
                  <p className="m-0 font-body text-xs" style={{ color: 'var(--color-muted)' }}>
                    {item.note}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* 03 · Control. The gate and the four laws are one argument — who decides,
          and what no flag can turn off — so they share a chapter. */}
      <section
        ref={gateRef}
        className={`mt-[var(--space-2xl)] border-t pt-[var(--space-lg)]${gateIn ? ' is-in' : ''}`}
        style={{ borderColor: 'var(--color-rule)' }}
      >
        <Tag n="03">the form is filled · the submit is not pressed</Tag>
        <div className="grid gap-[var(--space-md)] lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center lg:gap-[var(--space-xl)]">
          {/* The gate as an object on the page. Drawn, not filled: the word is an
              outline you have to cross. leading below 1 makes the glyph overflow
              its line box, so the descender of the y collided with the next
              block's label — the box gets the descender back as padding rather
              than the type losing its tightness. */}
          <p
            className="rise stroked stroked--fill m-0 pb-[0.14em] font-display text-giant leading-[0.8]"
            style={{ letterSpacing: '-0.05em', WebkitTextStrokeWidth: '2.5px', '--i': 1 }}
          >
            {gate.word}
          </p>
          <p className="rise m-0 max-w-[52ch] font-text text-read-lg leading-[1.55]" style={{ color: 'var(--color-ink)' }}>
            {gate.body}
          </p>
        </div>

        <div ref={lawsRef} className={`mt-[var(--space-xl)]${lawsIn ? ' is-in' : ''}`}>
          <Tag>four laws · no flag turns any of them off</Tag>
          <ol className="mt-[var(--space-md)] grid list-none gap-x-[var(--space-lg)] gap-y-[var(--space-md)] p-0 sm:grid-cols-2 lg:grid-cols-4">
            {ironLaws.map((item, i) => (
              <li
                key={item.law}
                className="rise min-w-0 border-t pt-[var(--space-sm)]"
                style={{ borderColor: 'var(--color-rule-2)', '--i': i + 1 }}
              >
                <span className="font-body text-2xs" style={{ color: 'var(--color-accent)' }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 className="mt-[var(--space-2xs)] font-display text-lg leading-snug">{item.law}</h3>
                <p
                  className="mt-[var(--space-2xs)] mb-0 font-text text-read leading-[1.5]"
                  style={{ color: 'var(--color-muted)' }}
                >
                  {item.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 04 · Aftermath: the lane, what the tracker keeps, and — since law 04
          says all state lands in your files — the actual files, scrolling past. */}
      <section
        ref={trackRef}
        className={`mt-[var(--space-2xl)] border-t pt-[var(--space-lg)]${trackIn ? ' is-in' : ''}`}
        style={{ borderColor: 'var(--color-rule)' }}
      >
        <Tag n="04">after it goes out</Tag>
        <div className="track mt-[var(--space-md)]">
          <span className="track__runner" aria-hidden="true" />
          <div className="track__stages">
            {lane.map((stage, i) => (
              <span key={stage} className="track__stage" data-open={String(i < 3)} style={{ '--si': i }}>
                {stage}
              </span>
            ))}
          </div>
          <p className="track__fallback m-0">
            needsFallback — the agent gave up; a human has to take this one
          </p>
        </div>

        <div className="mt-[var(--space-xl)] grid gap-[var(--space-lg)] lg:grid-cols-3">
          {tracking.map((item, i) => (
            <div key={item.heading} className="rise min-w-0" style={{ '--i': i + 1 }}>
              <h3 className="font-display text-h3 leading-snug">{item.heading}</h3>
              <p
                className="mt-[var(--space-2xs)] mb-0 font-text text-read leading-[1.55]"
                style={{ color: 'var(--color-muted)' }}
              >
                {item.body}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-[var(--space-xl)]">
          <Tag>everything it writes lands under ~/.coforce</Tag>
          <div className="marquee mt-[var(--space-xs)]" aria-hidden="true">
            <div className="marquee__row">
              {[...dataHome, ...dataHome].map((entry, i) => (
                <span className="marquee__item" key={`${entry.path}-${i}`}>
                  <b>{entry.path}</b> — {entry.note}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Closing CTA — the same wash band as the crossing, bookending the page,
          and the same command as the hero, because the command IS the product's
          only door. */}
      <section
        ref={ctaRef}
        className={`band mt-[var(--space-2xl)]${ctaIn ? ' is-in' : ''}`}
      >
        <Tag tone="accent">first run</Tag>
        <div className="grid gap-[var(--space-md)] lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-center lg:gap-[var(--space-xl)]">
          <div className="min-w-0">
            <p
              className="rise m-0 mt-[var(--space-2xs)] font-display text-h2 leading-[1.05]"
              style={{ letterSpacing: '-0.02em' }}
            >
              {firstRun.promise}
            </p>
            <p
              className="rise mt-[var(--space-sm)] mb-0 max-w-[58ch] font-text text-read leading-[1.55]"
              style={{ color: 'var(--color-ink-2)', '--i': 2 }}
            >
              {firstRun.detail}
            </p>
          </div>
          <div className="rise min-w-0" style={{ '--i': 3 }}>
            <InstallBlock />
            <p className="mt-[var(--space-xs)] mb-0 flex flex-wrap items-center gap-[var(--space-sm)] font-body text-2xs" style={{ color: 'var(--color-faint)' }}>
              <a className="ghbtn" href={product.repo}>star it on github ↗</a>
              <span>{requirements.join(' · ')}</span>
            </p>
          </div>
        </div>
      </section>

      <footer
        className="mt-[var(--space-lg)] flex flex-wrap items-baseline justify-between gap-[var(--space-sm)] font-body text-xs"
        style={{ color: 'var(--color-faint)' }}
      >
        <a
          href={product.repo}
          className="underline decoration-1 underline-offset-4 transition-colors"
          style={{ color: 'var(--color-accent-soft)', textDecorationColor: 'var(--color-accent-line)' }}
        >
          {product.repo.replace('https://', '')}
        </a>
        <span>{product.license} · no account, no telemetry</span>
      </footer>
    </main>
  );
}
