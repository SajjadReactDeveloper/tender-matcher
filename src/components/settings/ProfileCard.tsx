'use client';

import { useState } from 'react';
import { api } from '../api-client';
import { num } from '../fmt';
import { useToast } from '../Toasts';
import { useApi } from '../useApi';

interface Profile {
  text: string;
  source: 'saved' | 'default';
  max: number;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// The company description the AI uses to screen and score every tender. Saved in the database; until one is saved the app
// uses the built-in file config/profile.md.
export function ProfileCard() {
  const { toast } = useToast();
  const { data, error, loading, reload } = useApi<Profile>('/api/settings/profile');
  const [draft, setDraft] = useState<string | null>(null); // null = not edited: show what the server holds
  const [busy, setBusy] = useState(false);

  const text = draft ?? data?.text ?? '';
  const dirty = data !== null && draft !== null && draft !== data.text;
  const max = data?.max ?? 20000;

  const save = async () => {
    setBusy(true);
    try {
      await api('/api/settings/profile', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ text }) });
      toast('Profile saved. It applies to the next screening and analysis.');
      setDraft(null);
      reload();
    } catch (e) {
      toast(message(e), 'err');
    }
    setBusy(false);
  };

  const reset = async () => {
    setBusy(true);
    try {
      await api('/api/settings/profile', { method: 'DELETE' });
      toast('Profile reset to the built-in file.');
      setDraft(null);
      reload();
    } catch (e) {
      toast(message(e), 'err');
    }
    setBusy(false);
  };

  return (
    <section className="card" style={{ marginTop: 18 }}>
      <div className="card-head">
        <h2>Company profile</h2>
        <p>{data ? (data.source === 'saved' ? 'Using the profile saved here' : 'Using the built-in profile file') : ''}</p>
      </div>
      <div className="card-body">
        <p className="muted" style={{ margin: '0 0 12px', fontSize: 13.5 }}>
          What Funavry does, what to bid on, and what is not a match. The AI reads this for every tender. Tenders already scored are not re-scored when you change it.
        </p>
        {error ? (
          <p className="result bad">
            Could not load the profile: {error}{' '}
            <button type="button" className="link" onClick={reload}>
              Try again
            </button>
          </p>
        ) : loading && !data ? (
          <span className="sk" style={{ height: 220 }} aria-label="Loading" />
        ) : (
          <>
            <textarea
              className="profile-box"
              aria-label="Company profile"
              value={text}
              maxLength={max + 2000}
              spellCheck
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
            />
            <div className="profile-foot">
              <span className={text.trim().length > max ? 'result bad' : 'muted'} style={{ fontSize: 13 }}>
                {num(text.trim().length)} of {num(max)} characters
              </span>
              <div style={{ display: 'flex', gap: 10 }}>
                {data?.source === 'saved' && (
                  <button type="button" className="btn danger" onClick={reset} disabled={busy}>
                    Reset to default
                  </button>
                )}
                <button type="button" className="btn primary" onClick={save} disabled={busy || !dirty || !text.trim() || text.trim().length > max}>
                  {busy ? 'Saving...' : 'Save profile'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
