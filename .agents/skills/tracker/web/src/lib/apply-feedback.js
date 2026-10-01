// UI progress reflects acknowledged work, never guesses from a terminal phase.
export const APPLY_BANNER = {
  queueing: 'Adding application to your tracker…',
  working: 'Preparing your application…',
  awaiting_confirm: 'Review before submitting',
  submitting: 'Submitting your application…',
  submitted: 'Application submitted',
  failed: 'Application needs your help',
  error: 'Could not start the application',
  manual: 'Run the application command',
};

export function applicationSteps(phase, { queued, prepared }) {
  return [
    ['Added to your tracker', queued ? 'done' : phase === 'queueing' ? 'active' : 'todo'],
    ['Claude fills the form and uploads your resume', prepared ? 'done' : phase === 'working' ? 'active' : 'todo'],
    ['You review and confirm this submission', phase === 'awaiting_confirm' ? 'active' : ['submitting', 'submitted'].includes(phase) ? 'done' : 'todo'],
    ['Application submitted and tracked', phase === 'submitted' ? 'done' : phase === 'submitting' ? 'active' : 'todo'],
  ];
}
