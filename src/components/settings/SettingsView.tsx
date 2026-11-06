'use client';

import { useState } from 'react';
import { api } from '../api-client';
import { ms, num, usd } from '../fmt';
import { useToast } from '../Toasts';
import { useApi } from '../useApi';

interface ProviderInfo {
  id: string;
  label: string;
  defaultText: string;
  defaultVision: string;
  textModels: string[];
  visionModels: string[];
}
interface KeyStatus {
  provider: string;
  configured: boolean;
  last4: string | null;
  source: 'dashboard' | 'env' | 'none';
}
interface Settings {
  provider: string;
  textModel: string;
  visionModel: string;
  providers: ProviderInfo[];
  keys: KeyStatus[];
  encryptionConfigured: boolean;
}
interface Usage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  rateLimited: number;
  errors: number;
  estCostUsd: number;
  byModel: { provider: string; model: string; calls: number; inputTokens: number; outputTokens: number; estCostUsd: number }[];
}
interface TestResult {
  ok: boolean;
  model: string;
  latencyMs: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  error?: string;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const CUSTOM = '__custom__';
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function SettingsView() {
  const { data, error, loading, reload } = useApi<Settings>('/api/settings');

  if (error) {
    return (
      <>
        <Head />
        <section className="card empty error">
          <b>Could not load settings</b>
          {error}
          <br />
          <button type="button" className="btn" onClick={reload}>
            Try again
          </button>
        </section>
      </>
    );
  }
  if (loading || !data) {
    return (
      <>
        <Head />
        <span className="sk" style={{ height: 220 }} aria-label="Loading" />
      </>
    );
  }
  return (
    <>
      <Head />
      <div className="grid-2">
        <div style={{ display: 'grid', gap: 18 }}>
          <ModelCard settings={data} onSaved={reload} />
          <KeysCard settings={data} onChanged={reload} />
        </div>
        <UsageCard />
      </div>
    </>
  );
}

const Head = () => (
  <div className="page-head">
    <div>
      <h1>Settings</h1>
      <p>Choose the AI provider and model, and keep the API keys here instead of in Vercel.</p>
    </div>
  </div>
);

function ModelField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  const custom = !options.includes(value);
  return (
    <div className="field">
      <label>
        {label}
        <select value={custom ? CUSTOM : value} onChange={(e) => onChange(e.target.value === CUSTOM ? '' : e.target.value)} style={{ marginTop: 6 }}>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          <option value={CUSTOM}>Custom model id...</option>
        </select>
      </label>
      {custom && <input aria-label={`${label} (custom id)`} value={value} placeholder="Type the exact model id" onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}

function ModelCard({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const { toast } = useToast();
  const [provider, setProvider] = useState(settings.provider);
  const [text, setText] = useState(settings.textModel);
  const [vision, setVision] = useState(settings.visionModel);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const info = settings.providers.find((p) => p.id === provider) ?? settings.providers[0];
  const dirty = provider !== settings.provider || text !== settings.textModel || vision !== settings.visionModel;

  const pick = (p: ProviderInfo) => {
    setProvider(p.id);
    setText(p.defaultText);
    setVision(p.defaultVision);
    setResult(null);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api('/api/settings', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ provider, textModel: text.trim() || null, visionModel: vision.trim() || null }) });
      toast('AI settings saved. They apply from the next AI call.');
      onSaved();
    } catch (e) {
      toast(message(e), 'err');
    }
    setSaving(false);
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult((await (await api('/api/settings/test', { method: 'POST', headers: JSON_HEADERS, body: '{}' })).json()) as TestResult);
    } catch (e) {
      setResult({ ok: false, model: '', latencyMs: 0, error: message(e) });
    }
    setTesting(false);
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Provider and model</h2>
        <p>Applies to the next AI call, even during a run</p>
      </div>
      <div className="card-body">
        <div className="field">
          <span>Provider</span>
          <div className="providers" role="group" aria-label="AI provider">
            {settings.providers.map((p) => (
              <button key={p.id} type="button" className="provider" aria-pressed={provider === p.id} onClick={() => pick(p)}>
                <b>{p.label}</b>
                <small>{p.defaultText}</small>
              </button>
            ))}
          </div>
        </div>
        <ModelField label="Text model" value={text} options={info.textModels} onChange={setText} />
        <ModelField label="Vision model (reads scanned pages)" value={vision} options={info.visionModels} onChange={setVision} />
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn primary" onClick={save} disabled={!dirty || saving}>
            {saving ? 'Saving...' : 'Save model settings'}
          </button>
          <button type="button" className="btn" onClick={test} disabled={testing || dirty}>
            {testing ? 'Testing...' : 'Test connection'}
          </button>
        </div>
        {dirty && <p className="muted" style={{ fontSize: 13, margin: '10px 0 0' }}>Save your changes to test the connection.</p>}
        {result && (
          <p className={`result ${result.ok ? 'good' : 'bad'}`} role="status">
            {result.ok
              ? `Connected to ${result.model} in ${ms(result.latencyMs)}. Tokens used: ${num(result.inputTokens)} in, ${num(result.outputTokens)} out.`
              : `Could not connect: ${result.error}`}
          </p>
        )}
      </div>
    </section>
  );
}

function KeysCard({ settings, onChanged }: { settings: Settings; onChanged: () => void }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>API keys</h2>
        <p>Stored encrypted. Only the last 4 characters are ever shown.</p>
      </div>
      <div className="card-body">
        {!settings.encryptionConfigured && (
          <p className="notice" role="note">
            Saving keys here is off. Add the SETTINGS_ENCRYPTION_KEY environment variable in Vercel (the steps are in docs/DEPLOY.md) and redeploy. Keys set as environment variables keep working.
          </p>
        )}
        {settings.providers.map((p) => (
          <KeyRow key={p.id} provider={p} status={settings.keys.find((k) => k.provider === p.id)} enabled={settings.encryptionConfigured} onChanged={onChanged} />
        ))}
      </div>
    </section>
  );
}

function KeyRow({ provider, status, enabled, onChanged }: { provider: ProviderInfo; status?: KeyStatus; enabled: boolean; onChanged: () => void }) {
  const { toast } = useToast();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const where = !status || status.source === 'none' ? 'Not set' : status.source === 'dashboard' ? `Saved here, ends in ${status.last4}` : `From an environment variable, ends in ${status.last4}`;

  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/settings/keys/${provider.id}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ key: value }) });
      setValue(''); // the key never stays in the page after it is sent
      toast(`${provider.label} key saved.`);
      onChanged();
    } catch (e) {
      toast(message(e), 'err');
    }
    setBusy(false);
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api(`/api/settings/keys/${provider.id}`, { method: 'DELETE' });
      toast(`${provider.label} key removed.`);
      onChanged();
    } catch (e) {
      toast(message(e), 'err');
    }
    setBusy(false);
  };

  return (
    <div className="keyrow">
      <div className="name">
        {provider.label}
        <small>{where}</small>
      </div>
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        aria-label={`${provider.label} API key`}
        placeholder={status?.configured ? 'Paste a new key to replace it' : 'Paste your API key'}
        value={value}
        disabled={!enabled || busy}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="button" className="btn small primary" onClick={save} disabled={!enabled || busy || !value.trim()}>
        {status?.source === 'dashboard' ? 'Replace key' : 'Save key'}
      </button>
      {status?.source === 'dashboard' && (
        <button type="button" className="btn small danger" onClick={remove} disabled={busy}>
          Remove
        </button>
      )}
    </div>
  );
}

const WINDOWS = [
  { hours: 24, label: '24 hours' },
  { hours: 168, label: '7 days' },
  { hours: 720, label: '30 days' },
];

function UsageCard() {
  const [hours, setHours] = useState(24);
  const { data, error, loading } = useApi<Usage>(`/api/usage?hours=${hours}`);

  return (
    <section className="card">
      <div className="card-head">
        <h2>AI usage</h2>
        <p>Costs are estimates</p>
      </div>
      <div className="card-body">
        <div className="tabs usage-tabs" role="tablist" aria-label="Usage window">
          {WINDOWS.map((w) => (
            <button key={w.hours} type="button" role="tab" aria-selected={hours === w.hours} onClick={() => setHours(w.hours)}>
              {w.label}
            </button>
          ))}
        </div>
        {error ? (
          <p className="result bad">{error}</p>
        ) : loading && !data ? (
          <span className="sk" style={{ height: 120 }} aria-label="Loading" />
        ) : data && data.calls === 0 ? (
          <div className="empty" style={{ padding: '24px 0' }}>
            <b>No AI calls in this period</b>
            Usage appears here after a fetch.
          </div>
        ) : data ? (
          <>
            <dl className="kv">
              <dt>AI calls</dt>
              <dd>{num(data.calls)}</dd>
              <dt>Tokens in</dt>
              <dd>{num(data.inputTokens)}</dd>
              <dt>Tokens out</dt>
              <dd>{num(data.outputTokens)}</dd>
              <dt>Rate limited</dt>
              <dd>{num(data.rateLimited)}</dd>
              <dt>Errors</dt>
              <dd>{num(data.errors)}</dd>
              <dt>Estimated cost</dt>
              <dd>{data.estCostUsd > 0 ? usd(data.estCostUsd) : 'n/a'}</dd>
            </dl>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th className="num">Calls</th>
                    <th className="num">In</th>
                    <th className="num">Out</th>
                    <th className="num">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byModel.map((m) => (
                    <tr key={`${m.provider}:${m.model}`}>
                      <td>
                        {m.model}
                        <br />
                        <span className="muted">{m.provider}</span>
                      </td>
                      <td className="num">{num(m.calls)}</td>
                      <td className="num">{num(m.inputTokens)}</td>
                      <td className="num">{num(m.outputTokens)}</td>
                      <td className="num">{m.estCostUsd > 0 ? usd(m.estCostUsd) : 'n/a'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
