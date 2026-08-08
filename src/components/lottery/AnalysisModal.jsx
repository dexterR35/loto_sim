import { useState } from 'react';
import { BarChart3, BrainCircuit, Calculator, ChevronDown, ChevronRight, Database, Hash, LineChart, Search, Sparkles, Trophy } from 'lucide-react';
import {
  LineProfileStats,
  MatchHistogram,
  NumberBreakdownTable,
  ScoreBreakdown
} from './Calculator';
import { NumberPill, NumberRow } from './index';
import { Modal, Tabs } from '../ui';

const DETAIL_TABS = [
  { key: 'archive', label: 'Analiză arhivă', icon: BarChart3 },
  { key: 'ml', label: 'ML predicții', icon: BrainCircuit },
  { key: 'rag', label: 'RAG similar', icon: Database },
  { key: 'overview', label: 'Scor', icon: Sparkles },
  { key: 'signals', label: 'Semnale', icon: LineChart },
  { key: 'numbers', label: 'Numere', icon: Hash }
];

function formatCategoryValue(value) {
  if (value == null || value === '' || value === 'REPORT') return value || '—';
  const num = Number(String(value).replace(/\./g, '').replace(',', '.'));
  if (Number.isNaN(num)) return value;
  return num.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function MatchSummary({ histogram = [], totalDraws }) {
  const byCount = {};
  histogram.forEach((item) => {
    const key = String(item.match).replace('+J', '');
    if (!byCount[key]) byCount[key] = 0;
    byCount[key] += item.count;
  });

  const rows = [1, 2, 3, 4, 5, 6].map((n) => ({
    match: n,
    count: byCount[String(n)] || 0
  }));

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-black text-ink">Ce ați fi câștigat jucând aceste numere de-a lungul timpului?</h3>
      <ul className="space-y-1.5 text-sm">
        {rows.map(({ match, count }) => (
          <li key={match} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-line bg-field/50 px-3 py-2">
            <span className="text-muted">
              Exact <span className="font-black text-ink">{match}</span>{' '}
              {match === 1 ? 'număr' : 'numere'} din cele de mai sus {match === 1 ? 'a ieșit' : 'au ieșit'} de{' '}
              <span className="font-black text-primary">{count}</span> ori
            </span>
            {count > 0 && match >= 2 ? (
              <span className="text-xs font-bold text-secondary">(detalii mai jos)</span>
            ) : null}
          </li>
        ))}
      </ul>
      {totalDraws ? (
        <p className="text-xs text-muted">Bazat pe {totalDraws.toLocaleString()} extrageri din arhivă (1993–prezent).</p>
      ) : null}
    </div>
  );
}

function NumberFrequencyList({ rows = [] }) {
  if (!rows.length) return null;
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.number} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm">
          <NumberPill value={row.number} tone={row.signal || 'default'} size="sm" />
          <span className="text-muted">
            a fost extras de <span className="font-black text-ink">{row.count}</span> ori
            {row.last_draw_date_raw ? (
              <>, ultima dată: <span className="font-bold text-ink">{row.last_draw_date_raw}</span></>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}

function DrawMatchTable({ title, draws = [], selectedNumbers = [] }) {
  const [expanded, setExpanded] = useState(true);
  if (!draws.length) return null;
  const selectedSet = new Set(selectedNumbers);

  return (
    <div className="rounded-xl border border-line overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 bg-field px-4 py-3 text-left text-sm font-black text-ink hover:bg-field/80"
      >
        <span>{title}</span>
        <span className="flex items-center gap-2 text-xs font-bold text-muted">
          {draws.length} extrageri
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
      </button>
      {expanded ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead>
              <tr className="border-b border-line bg-field/50 text-[10px] uppercase tracking-wide text-muted">
                <th className="px-3 py-2">Data extragerii</th>
                <th className="px-3 py-2">Numere extrase</th>
                <th className="px-3 py-2">Potriviri</th>
                <th className="px-3 py-2">Cat. I</th>
                <th className="px-3 py-2">Cat. II</th>
                <th className="px-3 py-2">Cat. III</th>
              </tr>
            </thead>
            <tbody>
              {draws.map((draw) => {
                const drawn = (draw.drawn_numbers || []).slice(0, 6);
                const matched = draw.matched_numbers || drawn.filter((n) => selectedSet.has(Number(n)));
                const cat = draw.category_data || {};
                return (
                  <tr key={draw.draw_date_iso || draw.draw_date_raw} className="border-b border-line/70 hover:bg-field/30">
                    <td className="px-3 py-2.5 font-bold text-ink whitespace-nowrap">{draw.draw_date_raw}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {drawn.map((n) => (
                          <span
                            key={n}
                            className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full text-[10px] font-black ${
                              selectedSet.has(Number(n))
                                ? 'bg-primary text-white'
                                : 'bg-slate-100 text-muted'
                            }`}
                          >
                            {n}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {matched.map((n) => (
                          <NumberPill key={n} value={n} tone="hot" size="sm" />
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-muted">
                      {cat.I?.numar_castiguri ?? '—'}
                      <br />
                      <span className="font-bold">{formatCategoryValue(cat.I?.valoare_castig)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-muted">
                      {cat.II?.numar_castiguri ?? '—'}
                      <br />
                      <span className="font-bold">{formatCategoryValue(cat.II?.valoare_castig)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-muted">
                      {cat.III?.numar_castiguri ?? '—'}
                      <br />
                      <span className="font-bold">{formatCategoryValue(cat.III?.valoare_castig)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function ArchiveAnalysis({ result }) {
  const matchesByCount = result.matches_by_count || {};
  const selected = result.numbers || [];

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
        <div className="text-xs font-black uppercase tracking-wide text-primary">Numere trimise spre analiză</div>
        <div className="mt-3">
          <NumberRow values={selected} size="md" />
        </div>
      </div>

      <p className="text-xs leading-6 text-muted">
        Prin intermediul informațiilor de mai jos puteți afla când și în ce combinații au apărut numerele pe care
        intenționați să le jucați în cadrul extragerilor anterioare, începând cu anul 1993 și până în prezent.
      </p>

      <MatchSummary histogram={result.histogram} totalDraws={result.total_draws} />
      <NumberFrequencyList rows={result.number_breakdown} />

      {[6, 5, 4, 3, 2].map((level) => {
        const draws = matchesByCount[String(level)] || [];
        if (!draws.length) return null;
        return (
          <DrawMatchTable
            key={level}
            title={`Detaliile extragerilor cu ${level} numere câștigătoare dintre cele trimise spre analiză`}
            draws={draws}
            selectedNumbers={selected}
          />
        );
      })}

      {result.best_match ? (
        <div className="rounded-xl border border-secondary/20 bg-secondary/5 p-4">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-secondary">
            <Trophy size={14} /> Cea mai bună potrivire din arhivă
          </div>
          <div className="mt-2 text-sm font-black text-ink">
            {result.best_match.match_count} potriviri pe {result.best_match.draw?.draw_date_raw}
          </div>
          <div className="mt-3">
            <NumberRow values={result.best_match.matched_numbers} size="sm" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AnalysisOverview({ result }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-field p-4">
        <div className="text-xs font-black uppercase tracking-wide text-muted">Linie analizată</div>
        <div className="mt-3">
          {result.code ? (
            <div className="font-mono text-3xl font-black tracking-[0.3em] text-ink">{result.code}</div>
          ) : (
            <NumberRow values={result.numbers} joker={result.joker} size="md" />
          )}
        </div>
      </div>
      <ScoreBreakdown components={result.components} score={result.score} backtest={result.backtest} />
      {result.profile?.sum != null ? <LineProfileStats profile={result.profile} /> : null}
      {result.histogram?.length ? (
        <MatchHistogram histogram={result.histogram} totalDraws={result.total_draws} />
      ) : null}
    </div>
  );
}

function AnalysisRAG({ result }) {
  const rag = result?.rag;
  if (!rag) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-field/70 px-4 py-8 text-center text-sm text-muted">
        RAG retrieval indisponibil pentru această analiză.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-secondary/20 bg-secondary/5 p-4 text-sm">
        <div className="font-black text-secondary">Vector index</div>
        <p className="mt-1 text-muted">{rag.method}</p>
        <p className="mt-1 text-xs font-bold text-ink">{rag.indexed_draws?.toLocaleString()} extrageri indexate local</p>
      </div>

      {rag.retrieval_top_numbers?.length ? (
        <div>
          <div className="mb-2 text-sm font-black text-ink">Numere din extrageri similare (RAG)</div>
          <div className="flex flex-wrap gap-2">
            {rag.retrieval_top_numbers.map((item) => (
              <div key={item.number} className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-2 py-1">
                <NumberPill value={item.number} tone="cold" size="sm" />
                <span className="text-[10px] font-black text-secondary">{(item.weight * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {rag.similar_draws?.length ? (
        <div className="overflow-auto rounded-xl border border-line">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead>
              <tr className="bg-field text-[10px] uppercase tracking-wide text-muted">
                <th className="px-3 py-2">Data</th>
                <th className="px-3 py-2">Numere</th>
                <th className="px-3 py-2">Similaritate</th>
              </tr>
            </thead>
            <tbody>
              {rag.similar_draws.map((draw) => (
                <tr key={draw.draw_date_iso || draw.draw_date_raw} className="border-t border-line">
                  <td className="px-3 py-2 font-bold text-ink whitespace-nowrap">{draw.draw_date_raw}</td>
                  <td className="px-3 py-2 font-mono text-xs">{(draw.drawn_numbers || []).join(', ')}</td>
                  <td className="px-3 py-2 font-black text-secondary">{(draw.similarity * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function AnalysisML({ result }) {
  const ml = result?.ml;
  if (!ml) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-field/70 px-4 py-8 text-center text-sm text-muted">
        Predicții ML indisponibile pentru această analiză.
      </div>
    );
  }

  const line = ml.line_score || {};
  const models = ml.models || {};

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-grape/20 bg-grape/5 p-4">
          <div className="text-[10px] font-black uppercase tracking-wide text-grape">Scor linie ML</div>
          <div className="mt-1 text-3xl font-black text-ink">{line.ml_line_score ?? '—'}</div>
          <div className="text-xs text-muted">probabilitate medie × 100</div>
        </div>
        <div className="rounded-xl border border-line bg-field p-4">
          <div className="text-[10px] font-black uppercase tracking-wide text-muted">sklearn AUC</div>
          <div className="mt-1 text-xl font-black text-ink">
            {models.sklearn?.metrics?.roc_auc != null
              ? Number(models.sklearn.metrics.roc_auc).toFixed(3)
              : '—'}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-field p-4">
          <div className="text-[10px] font-black uppercase tracking-wide text-muted">LSTM AUC</div>
          <div className="mt-1 text-xl font-black text-ink">
            {models.lstm?.metrics?.val_auc != null
              ? Number(models.lstm.metrics.val_auc).toFixed(3)
              : '—'}
          </div>
        </div>
      </div>

      {ml.training_note ? (
        <p className="text-xs text-secondary font-bold">{ml.training_note}</p>
      ) : null}

      {line.per_number?.length ? (
        <div className="overflow-auto rounded-xl border border-line">
          <table className="w-full min-w-[400px] text-left text-sm">
            <thead>
              <tr className="bg-field text-[10px] uppercase tracking-wide text-muted">
                <th className="px-3 py-2">Număr</th>
                <th className="px-3 py-2">Rank ML</th>
                <th className="px-3 py-2">Prob. blend</th>
                <th className="px-3 py-2">Arhivă</th>
              </tr>
            </thead>
            <tbody>
              {line.per_number.map((row) => (
                <tr key={row.number} className="border-t border-line">
                  <td className="px-3 py-2"><NumberPill value={row.number} tone="hot" size="sm" /></td>
                  <td className="px-3 py-2 font-bold text-muted">#{row.rank}</td>
                  <td className="px-3 py-2 font-black text-grape">{(row.probability_blend * 100).toFixed(1)}%</td>
                  <td className="px-3 py-2 text-muted">{row.archive_count}×</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {ml.top_numbers?.length ? (
        <div>
          <div className="mb-2 text-sm font-black text-ink">Top 12 predicții globale (arhivă completă)</div>
          <div className="flex flex-wrap gap-2">
            {ml.top_numbers.map((item) => (
              <div key={item.number} className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-2 py-1">
                <NumberPill value={item.number} tone="default" size="sm" />
                <span className="text-[10px] font-black text-grape">{(item.probability_blend * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {ml.features?.length ? (
        <ul className="space-y-1 text-xs text-muted">
          {ml.features.map((f) => (
            <li key={f}>· {f}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function AnalysisSignals({ result }) {
  return <ScoreBreakdown components={result.components} score={result.score} backtest={result.backtest} />;
}

export function AnalysisDetailModal({ open, onClose, result, loading = false }) {
  const [activeTab, setActiveTab] = useState('archive');

  const title = result?.code
    ? `Analiză Noroc ${result.code}`
    : 'Analiza numerelor pentru o variantă simplă sau multiplă Loto 6/49';
  const description = result?.numbers?.length
    ? `Numere: ${result.numbers.join(', ')}`
    : 'Informații statistice din arhiva extragerilor';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      icon={Search}
      size="full"
    >
      {loading ? (
        <div className="flex min-h-48 items-center justify-center text-sm font-bold text-muted">Se analizează arhiva…</div>
      ) : result ? (
        <div className="space-y-4">
          <Tabs items={DETAIL_TABS} active={activeTab} onChange={setActiveTab} />
          <div className="pt-1">
            {activeTab === 'archive' ? <ArchiveAnalysis result={result} /> : null}
            {activeTab === 'ml' ? <AnalysisML result={result} /> : null}
            {activeTab === 'rag' ? <AnalysisRAG result={result} /> : null}
            {activeTab === 'overview' ? <AnalysisOverview result={result} /> : null}
            {activeTab === 'signals' ? <AnalysisSignals result={result} /> : null}
            {activeTab === 'numbers' ? <NumberBreakdownTable rows={result.number_breakdown} /> : null}
          </div>
        </div>
      ) : (
        <div className="flex min-h-48 flex-col items-center justify-center text-center">
          <Calculator className="mb-2 text-primary" size={22} />
          <div className="text-sm font-black text-ink">Nicio analiză încă</div>
          <p className="mt-2 max-w-md text-sm text-muted">Selectează numere și apasă „Analizează această variantă”.</p>
        </div>
      )}
    </Modal>
  );
}
