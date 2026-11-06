import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ConversationMode, ModelInfo, Provider } from "@mmc/shared";
import { api } from "../lib/api";
import { useAppData } from "../lib/appContext";

const PROVIDER_ORDER: Provider[] = ["anthropic", "openai", "google", "mock"];
const TIER_ORDER = { large: 0, medium: 1, small: 2 } as const;

function priceText(m: ModelInfo): string {
  if (m.provider === "mock") return "free, offline";
  if (m.inputPricePerMTok == null || m.outputPricePerMTok == null) return "";
  return `$${m.inputPricePerMTok} / $${m.outputPricePerMTok} per M tokens`;
}

export function NewConversationPage() {
  const { models, modelsError, refreshConversations } = useAppData();
  const navigate = useNavigate();

  const providers = useMemo(
    () => PROVIDER_ORDER.map((id) => models?.providers.find((p) => p.id === id)).filter((p) => !!p),
    [models],
  );
  const modelsBy = useMemo(() => {
    const map = new Map<Provider, ModelInfo[]>();
    for (const m of models?.models ?? []) {
      map.set(m.provider, [...(map.get(m.provider) ?? []), m]);
    }
    for (const list of map.values()) list.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);
    return map;
  }, [models]);

  const [mode, setMode] = useState<ConversationMode>("cross");
  const [cross, setCross] = useState<Partial<Record<Provider, { include: boolean; modelId: string }>>>({});
  const [sameProvider, setSameProvider] = useState<Provider>("anthropic");
  const [samePicked, setSamePicked] = useState<string[]>([]);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sensible defaults once the model list arrives.
  useEffect(() => {
    if (!models) return;
    const realAvailable = providers.filter((p) => p.available && p.id !== "mock");
    const initialCross: typeof cross = {};
    for (const p of providers) {
      const list = modelsBy.get(p.id) ?? [];
      const medium = list.find((m) => m.tier === "medium") ?? list[0];
      initialCross[p.id] = {
        include: p.available && (p.id !== "mock" ? true : realAvailable.length < 2),
        modelId: medium?.id ?? "",
      };
    }
    setCross(initialCross);
    const firstSame = realAvailable[0] ?? providers.find((p) => p.available);
    if (firstSame) {
      setSameProvider(firstSame.id);
      setSamePicked((modelsBy.get(firstSame.id) ?? []).slice(0, 3).map((m) => m.id));
    }
    setMode(realAvailable.length >= 2 ? "cross" : "same");
  }, [models, providers, modelsBy]);

  const crossIds = providers
    .filter((p) => p.available && cross[p.id]?.include && cross[p.id]?.modelId)
    .map((p) => cross[p.id]!.modelId);
  const sameIds = (modelsBy.get(sameProvider) ?? []).filter((m) => samePicked.includes(m.id)).map((m) => m.id);
  const modelIds = mode === "cross" ? crossIds : sameIds;
  const valid = modelIds.length >= 2 && modelIds.length <= 3;
  const availableCrossCount = providers.filter((p) => p.available).length;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const detail = await api.createConversation({ mode, modelIds, systemPrompt: systemPrompt.trim() || null });
      refreshConversations();
      navigate(`/c/${detail.conversation.id}`);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  if (modelsError) {
    return (
      <div className="new-page">
        <div className="new-card">
          <h1>Can't reach the server</h1>
          <p className="error-text">{modelsError}</p>
          <p className="muted">Start everything with <code>npm run dev</code> from the repo root.</p>
        </div>
      </div>
    );
  }
  if (!models) return <div className="new-page muted">Loading models…</div>;

  return (
    <div className="new-page">
      <form className="new-card" onSubmit={onSubmit}>
        <h1>New conversation</h1>
        <p className="muted" style={{ margin: 0 }}>
          One message goes to 2–3 models at once, and each keeps its own thread. Models are fixed for the conversation.
        </p>

        <div className="field">
          <span className="field-label" id="mode-label">Mode</span>
          <div className="segmented" role="group" aria-labelledby="mode-label">
            <button type="button" aria-pressed={mode === "cross"} onClick={() => setMode("cross")}>
              Cross-provider
            </button>
            <button type="button" aria-pressed={mode === "same"} onClick={() => setMode("same")}>
              Same-provider
            </button>
          </div>
        </div>

        {mode === "cross" ? (
          <div className="field">
            <span className="field-label">One model from each provider</span>
            {availableCrossCount < 2 && (
              <p className="notice">
                Cross-provider needs at least two providers with keys. Add keys to <code>.env</code>, or use Same-provider mode.
              </p>
            )}
            {providers.map((p) => {
              const sel = cross[p.id];
              const list = modelsBy.get(p.id) ?? [];
              const checkedCount = crossIds.length;
              const disableCheck = !p.available || (!sel?.include && checkedCount >= 3);
              return (
                <div key={p.id} className={`pick-row${p.available ? "" : " disabled"}`}>
                  <input
                    type="checkbox"
                    aria-label={`Include ${p.label}`}
                    checked={!!sel?.include && p.available}
                    disabled={disableCheck}
                    onChange={(e) => setCross((c) => ({ ...c, [p.id]: { modelId: sel?.modelId ?? "", include: e.target.checked } }))}
                  />
                  <strong>{p.label}</strong>
                  {p.available ? (
                    <select
                      aria-label={`${p.label} model`}
                      value={sel?.modelId ?? ""}
                      disabled={!sel?.include}
                      onChange={(e) => setCross((c) => ({ ...c, [p.id]: { include: true, modelId: e.target.value } }))}
                    >
                      {list.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label} {priceText(m) ? `— ${priceText(m)}` : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="muted" style={{ fontSize: "0.88em" }}>{p.unavailableReason}</span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="field">
            <label className="field-label" htmlFor="same-provider">Provider</label>
            <select
              id="same-provider"
              value={sameProvider}
              onChange={(e) => {
                const id = e.target.value as Provider;
                setSameProvider(id);
                setSamePicked((modelsBy.get(id) ?? []).slice(0, 3).map((m) => m.id));
              }}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.available}>
                  {p.label}
                  {p.available ? "" : ` — ${p.unavailableReason}`}
                </option>
              ))}
            </select>
            <div style={{ marginTop: 10 }}>
              {(modelsBy.get(sameProvider) ?? []).map((m) => {
                const checked = samePicked.includes(m.id);
                return (
                  <label key={m.id} className="model-check">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!m.available || (!checked && samePicked.length >= 3)}
                      onChange={(e) =>
                        setSamePicked((s) => (e.target.checked ? [...s, m.id] : s.filter((x) => x !== m.id)))
                      }
                    />
                    <span>{m.label}</span>
                    <span className="price">{priceText(m)}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <div className="field">
          <label className="field-label" htmlFor="system-prompt">
            System prompt <span className="muted" style={{ fontWeight: 400 }}>(optional, shared by every lane)</span>
          </label>
          <textarea
            id="system-prompt"
            className="system"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="e.g. Answer concisely."
          />
        </div>

        <div className="form-actions">
          <button type="submit" disabled={!valid || submitting}>
            {submitting ? "Starting…" : `Start with ${modelIds.length} model${modelIds.length === 1 ? "" : "s"}`}
          </button>
          {!valid && <span className="muted" style={{ fontSize: "0.88em" }}>Pick 2–3 models.</span>}
          {error && <span className="error-text">{error}</span>}
        </div>
      </form>
    </div>
  );
}
