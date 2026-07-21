const j = async res => {
  if (!res.ok) throw new Error((await res.text()) || res.status);
  return res.headers.get('content-type')?.includes('json') ? res.json() : res.text();
};
const post = (url, body, type = 'application/json') =>
  fetch(url, { method: 'POST', headers: { 'content-type': type }, body }).then(j);

export const api = {
  state: () => fetch('/api/state').then(j),
  discover: () => fetch('/api/discover').then(j),
  queue: job => post('/api/queue', JSON.stringify(job)),
  saveApps: apps => post('/api/apps', JSON.stringify(apps)),
  saveProfile: p => post('/api/profile', JSON.stringify(p)),
  savePrefs: p => post('/api/prefs', JSON.stringify(p)),
  saveInstructions: text => post('/api/instructions', text, 'text/plain'),
  importResume: text => post('/api/import', JSON.stringify({ text })),
  campaign: () => fetch('/api/campaign').then(j),
  syncCampaign: () => post('/api/campaign/sync', '{}'),
  campaignFeedback: (id, text) => post(`/api/campaign/jobs/${encodeURIComponent(id)}/feedback`, JSON.stringify({ text })),
  approveCampaignJob: id => post(`/api/campaign/jobs/${encodeURIComponent(id)}/approve`, '{}'),
  exportCampaign: () => post('/api/campaign/export', '{}'),
};
