import * as React from 'react';
import { browser } from 'webextension-polyfill-ts';
import { Download, Send, Terminal, Upload } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { JobApplication } from '@/types';

const STORAGE_KEY = 'jobApplications';

const STATUS_STYLES: Record<JobApplication['status'], string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  applied: 'bg-green-100 text-green-800',
  interviewing: 'bg-blue-100 text-blue-800',
  offer: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-gray-200 text-gray-700',
};

// migration shim for entries saved before failed/fallback became history events
const normalize = (app: JobApplication): JobApplication => {
  const legacy = app.status as string;
  if (legacy === 'failed' || legacy === 'fallback') {
    return { ...app, status: 'pending', needsFallback: true };
  }
  return app;
};

function fallbackCommand(url: string): string {
  return `claude "/apply ${url}"`;
}

const ApplyTab: React.FC = () => {
  const [applications, setApplications] = React.useState<JobApplication[]>([]);
  const [message, setMessage] = React.useState<string>('');
  const [copiedId, setCopiedId] = React.useState<string>('');

  React.useEffect(() => {
    const load = async () => {
      const data = await browser.storage.local.get(STORAGE_KEY);
      if (Array.isArray(data[STORAGE_KEY])) {
        setApplications(data[STORAGE_KEY].map(normalize));
      }
    };
    load().catch(error => console.error('Error loading applications:', error));
  }, []);

  const persist = async (updated: JobApplication[]) => {
    setApplications(updated);
    await browser.storage.local.set({ [STORAGE_KEY]: updated });
  };

  const upsertApplication = async (
    url: string,
    title: string,
    patch: Partial<JobApplication>,
    event?: string
  ) => {
    const now = new Date().toISOString();
    const withEvent = (app: JobApplication): JobApplication => ({
      ...app,
      ...patch,
      updatedAt: now,
      history: event
        ? [...(app.history || []), { date: now, event }]
        : app.history,
    });
    const existing = applications.find(app => app.url === url);
    const updated = existing
      ? applications.map(app => (app.url === url ? withEvent(app) : app))
      : [
          withEvent({
            id: `${Date.now()}`,
            url,
            title,
            status: 'pending',
            createdAt: now,
            updatedAt: now,
          }),
          ...applications,
        ];
    await persist(updated);
  };

  const setStatus = async (id: string, status: JobApplication['status']) => {
    const now = new Date().toISOString();
    await persist(
      applications.map(app =>
        app.id === id
          ? {
              ...app,
              status,
              updatedAt: now,
              history: [
                ...(app.history || []),
                { date: now, event: `status: ${app.status} → ${status} (extension)` },
              ],
            }
          : app
      )
    );
  };

  const removeApplication = async (id: string) => {
    await persist(applications.filter(app => app.id !== id));
  };

  // Sync with the local tracker (profile/applications.json, tracker skill):
  // export copies JSON to the clipboard, import merges a JSON file by url
  // with the newer updatedAt winning.
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const exportApplications = async () => {
    await navigator.clipboard.writeText(JSON.stringify(applications, null, 2));
    setMessage(
      'Copied JSON to clipboard — save it as profile/applications.json for the local tracker.'
    );
  };

  const importApplications = async (file: File) => {
    try {
      const imported: JobApplication[] = JSON.parse(await file.text());
      if (!Array.isArray(imported)) {
        throw new Error('expected a JSON array');
      }
      const byUrl = new Map(applications.map(app => [app.url, app]));
      imported.map(normalize).forEach(app => {
        const existing = byUrl.get(app.url);
        if (!existing || (app.updatedAt || '') > (existing.updatedAt || '')) {
          byUrl.set(app.url, app);
        }
      });
      const merged = [...byUrl.values()].sort((a, b) =>
        (b.updatedAt || '').localeCompare(a.updatedAt || '')
      );
      await persist(merged);
      setMessage(`Imported — ${merged.length} applications tracked.`);
    } catch (error) {
      console.error('Error importing applications:', error);
      setMessage(`Import failed: ${error.message}`);
    }
  };

  const copyFallback = async (app: JobApplication) => {
    await navigator.clipboard.writeText(fallbackCommand(app.url));
    setCopiedId(app.id);
    setTimeout(() => setCopiedId(''), 2000);
    await upsertApplication(
      app.url,
      app.title,
      { needsFallback: true },
      'handed to Claude fallback (command copied)'
    );
  };

  // Tier 1: scripted form-fill on the current tab from the stored profile.
  // On failure (nothing filled / required fields left), surface the Tier 2
  // fallback: a Claude CLI browser-use command.
  const autofillCurrentPage = async () => {
    setMessage('');
    try {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id || !tab.url || !tab.url.startsWith('http')) {
        setMessage('Open a job application page first.');
        return;
      }

      const profileData = await browser.storage.local.get('userProfile');
      if (!profileData.userProfile) {
        setMessage('No profile found. Set up your profile first.');
        return;
      }

      try {
        await browser.tabs.sendMessage(tab.id, { action: 'ping' });
      } catch {
        setMessage('Cannot access this page. Refresh it and try again.');
        return;
      }

      const result = await browser.tabs.sendMessage(tab.id, {
        action: 'autofillApplication',
        profile: JSON.parse(profileData.userProfile),
      });

      const failed =
        !result?.success ||
        result.filled === 0 ||
        result.unfilledRequired?.length > 0;

      await upsertApplication(
        tab.url,
        tab.title || tab.url,
        { status: 'pending', needsFallback: failed },
        failed
          ? `tier-1 autofill failed: ${result?.filled ?? 0} filled, ${result?.unfilledRequired?.length ?? 0} required unfilled`
          : `tier-1 autofill: ${result.filled}/${result.total} fields`
      );

      if (failed) {
        setMessage(
          result?.filled === 0
            ? 'No fillable fields matched — use the Claude fallback below.'
            : `Filled ${result.filled}, but ${result.unfilledRequired.length} required field(s) remain — finish manually or use the Claude fallback.`
        );
      } else {
        setMessage(
          `Filled ${result.filled}/${result.total} fields. Review and submit, then mark as applied.`
        );
      }
    } catch (error) {
      console.error('Error auto-filling application:', error);
      setMessage(`Error: ${error.message || 'auto-fill failed'}`);
    }
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={autofillCurrentPage}
        className="w-full bg-primary-500 hover:bg-primary-600 text-primary-foreground font-medium py-2 px-4 rounded text-sm focus:outline-none flex items-center justify-center gap-2"
      >
        <Send className="size-4" />
        Auto-fill Application on Current Page
      </button>

      {message && (
        <div className="text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded p-2">
          {message}
        </div>
      )}

      {applications.length === 0 ? (
        <p className="text-center text-sm text-gray-600 py-3">
          No tracked applications yet. Open a job posting and hit auto-fill.
        </p>
      ) : (
        <div className="max-h-[320px] overflow-y-auto scrollbar-invisible space-y-2 pr-1">
          {applications.map(app => (
            <Card key={app.id} className="p-2.5 shadow-sm">
              <div className="flex justify-between items-start gap-2">
                <a
                  href={app.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-medium text-primary-700 hover:underline line-clamp-2 break-all"
                  title={app.url}
                >
                  {app.title}
                </a>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Badge
                    variant="secondary"
                    className={`text-xs px-2 py-0.5 ${STATUS_STYLES[app.status]}`}
                  >
                    {app.status}
                  </Badge>
                  {app.needsFallback && app.status === 'pending' && (
                    <Badge
                      variant="secondary"
                      className="text-xs px-2 py-0.5 bg-purple-100 text-purple-800"
                    >
                      needs fallback
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex gap-1 mt-2 flex-wrap">
                {app.status !== 'applied' && (
                  <button
                    type="button"
                    onClick={() => setStatus(app.id, 'applied')}
                    className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-800 hover:bg-green-200"
                  >
                    Mark applied
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => copyFallback(app)}
                  className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-800 hover:bg-purple-200 flex items-center gap-1"
                  title={fallbackCommand(app.url)}
                >
                  <Terminal className="size-3" />
                  {copiedId === app.id ? 'Copied!' : 'Claude fallback'}
                </button>
                <button
                  type="button"
                  onClick={() => removeApplication(app.id)}
                  className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-800 hover:bg-red-200"
                >
                  Remove
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={exportApplications}
          className="flex-1 flex items-center justify-center gap-1 bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium py-1.5 px-2 rounded text-xs focus:outline-none"
        >
          <Upload className="size-3" />
          Export JSON
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex-1 flex items-center justify-center gap-1 bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium py-1.5 px-2 rounded text-xs focus:outline-none"
        >
          <Download className="size-3" />
          Import JSON
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) importApplications(file);
            e.target.value = '';
          }}
        />
      </div>

      <p className="text-[11px] text-gray-500 leading-snug">
        Tier 1 fills forms from your profile. If it fails or stalls, “Claude
        fallback” copies a CLI command that hands the application to Claude
        browser-use (the <code>apply</code> skill).
      </p>
    </div>
  );
};

export default ApplyTab;
