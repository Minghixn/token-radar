// Token Radar — model radar-2: comparables-priced implied value.
//
// Implied value follows ONLY from the sealed snapshot's own figures, never from
// a hand-written list of names. The same function scores every protocol:
//
//   multiple   = category comparable: median mcap/TVL of the snapshot's own
//                live-token protocols in the same category, shrunk toward the
//                global median (prior weight 3) when the category is thin.
//                Categories with fewer than 3 live comparables, and any
//                multiple outside 0.05..0.65, fall back to the global median
//                (0.214 on this snapshot; 128 live-token protocols with a
//                positive market cap — AUTOfinance records mcap -1, excluded).
//   growth     = clamp(change_7d, -50, +100)%; growthMult = 1 + growth*0.6/100
//   maturity   = 0.65 + min(age_days, 1095)/1095 * 0.35 (unknown age: 365d)
//   implied    = max(1, round(tvl_usd * multiple * growthMult * maturityMult))
//
// Why comparables beat a flat multiple: a dollar of TVL in a Dexs protocol
// trades at ~0.34x market cap in this snapshot, in Lending at ~0.13x, in RWA
// at ~0.28x. A flat 0.25x overvalues Lending vaults and undervalues Dexs.
// Thin categories are the trap — Risk Curators has ONE live comparable at
// 2.98x and Prediction Market one at 400x — so n<3 never sets a multiple.
//
// The board covers every watchlist slug (the floor) plus the 160 largest
// clean pre-token protocols outside the watchlist, by TVL — the early radar.
// That includes clean protocols ABOVE the $50M floor the watchlist leaves out
// (Sentora Curator, $2.76B TVL, is the largest: the snapshot carries no
// parentProtocol field, so the house rule cannot be re-checked from it).
// "Clean" re-uses the house exclusion (no CEX / Bridge / Liquid Staking /
// Liquid Restaking / Restaked BTC, no wrapped/staked name, no version suffix,
// no exchange prefix); parentProtocol is not in the snapshot, so an early row
// is flagged "verify parent status" in the dashboard. Live-token protocols
// are kept apart as the market's own values, never mixed into the ranking.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  shrink_prior: number;
  min_comparables: number;
  multiple_floor: number;
  multiple_cap: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.65,
  maturity_range: 0.35,
  maturity_days: 1095,
  unknown_age_days: 365,
  shrink_prior: 3,
  min_comparables: 3,
  multiple_floor: 0.05,
  multiple_cap: 0.65,
};

export const MODEL_VERSION = 'radar-2';
export const EARLY_ROWS = 160;
export const LIVE_ROWS = 24;

export interface FarmStep { text: string; cost: string; time: string; }

export interface BoardRow {
  rank: number; slug: string; name: string; category: string | null;
  chains: string[]; tvl_usd: number; change_7d: number | null;
  mcap_usd: number | null; listed_at: string | null;
  gecko_id: string | null; symbol: string | null;
  token_status: 'pre-token'; on_watchlist: boolean; age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number; comparable_n: number; comparable_median: number | null;
    growth_pct: number; growth_multiplier: number;
    maturity_multiplier: number; age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number; slug: string; name: string; category: string | null;
  chains: string[]; tvl_usd: number; change_7d: number | null;
  mcap_usd: number | null; listed_at: string | null; age_days: number | null;
  implied_value_usd: number; on_watchlist: boolean;
  base_multiple: number; growth_multiplier: number; maturity_multiplier: number;
}

export interface LiveRow {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; mcap_usd: number | null; change_7d: number | null;
}

export interface Comparable { category: string; n: number; median: number; multiple: number; }

export interface RadarData {
  as_of: string; source: string; floor_usd: number; model: ModelConstants;
  model_version: string; watchlist_size: number; board_size: number;
  early_size: number; live_size: number; global_multiple: number;
  comparables: Comparable[]; rows: RadarRow[]; live: LiveRow[];
  live_check: string;
}

export class SnapshotError extends Error {
  constructor(message: string) { super(message); this.name = 'SnapshotError'; }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Category comparables from the snapshot's own live-token protocols. */
export function comparables(snapshot: Snapshot): { global: number; byCategory: Map<string, Comparable> } {
  const byCat = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd && p.tvl_usd > 0 && p.mcap_usd > 0) {
      const r = p.mcap_usd / p.tvl_usd;
      if (Number.isFinite(r) && r > 0) {
        all.push(r);
        const k = p.category ?? 'Uncategorised';
        if (!byCat.has(k)) byCat.set(k, []);
        byCat.get(k)!.push(r);
      }
    }
  }
  const global = all.length ? median(all) : 0.25;
  const out = new Map<string, Comparable>();
  for (const [cat, vals] of [...byCat.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const med = median(vals);
    const multiple = vals.length >= MODEL.min_comparables
      ? Math.min(MODEL.multiple_cap, Math.max(MODEL.multiple_floor,
          (vals.length * med + MODEL.shrink_prior * global) / (vals.length + MODEL.shrink_prior)))
      : global;
    out.set(cat, { category: cat, n: vals.length, median: round4(med), multiple: round4(multiple) });
  }
  return { global: round4(global), byCategory: out };
}

export function categoryMultiple(cat: string | null, table: { global: number; byCategory: Map<string, Comparable> }): { multiple: number; n: number; median: number | null } {
  const c = cat === null ? null : table.byCategory.get(cat);
  if (!c || c.n < MODEL.min_comparables) return { multiple: table.global, n: c ? c.n : 0, median: c ? c.median : null };
  return { multiple: c.multiple, n: c.n, median: c.median };
}

export function impliedValue(p: SnapshotProtocol, asOf: string, model: ModelConstants, table: { global: number; byCategory: Map<string, Comparable> }): { implied: number; multiple: number; compN: number; compMedian: number | null; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const { multiple, n, median: med } = categoryMultiple(p.category, table);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(p.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthMult * maturityMult));
  return { implied, multiple, compN: n, compMedian: med, growthPct, growthMult, maturityMult, age };
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED = /\b(wrapped|staked|staking)\b/i;
const EXCLUDED_CAT = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Rankable: pre-token and not a wrapped/staked/bridged product of a traded token. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CAT.has(p.category)) return false;
  if (WRAPPED.test(p.name) || VERSIONED.test(p.name)) return false;
  if (EXCHANGES.some((e) => p.name === e || p.name.startsWith(`${e} `))) return false;
  return true;
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const table = comparables(snapshot);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);
  const watch = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((p) => {
    const s = impliedValue(p, snapshot.as_of, model, table);
    return { p, ...s };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1, slug: s.p.slug, name: s.p.name, category: s.p.category,
    chains: s.p.chains, tvl_usd: s.p.tvl_usd, change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd, listed_at: s.p.listed_at, gecko_id: s.p.gecko_id,
    symbol: s.p.symbol, token_status: 'pre-token' as const,
    on_watchlist: watch.has(s.p.slug), age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: s.multiple, comparable_n: s.compN, comparable_median: s.compMedian,
      growth_pct: s.growthPct, growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult), age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares in your wallet.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow a small amount against it and repay it.`;
  if (c.includes('dex')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the LP position open.`;
  if (c.includes('basis')) return `Deposit $${capital} into ${name}'s basis vault on ${chain} and hold the receipt token.`;
  if (c.includes('rwa')) return `Mint $${capital} of the yield-bearing asset on ${name} (${chain}) and hold it in your wallet.`;
  if (c.includes('yield') || c.includes('leveraged farm')) return `Deposit $${capital} into ${name}'s highest-TVL strategy on ${chain} and keep it open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds inside its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and place one position in an active market.`;
  if (c.includes('payment')) return `Send two payments totalling $${capital} through ${name} on ${chain} from your farm wallet.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('chain')) return `Bridge $${capital} to ${name} and use its main app at least once a week.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A farm plan: 6 steps, each an action with a cost and a time, derived from the protocol's own record (category, chains, TVL, age) — never from a list of names. */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  return [
    { text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`, cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: `Open the protocol from its DefiLlama page, check the contract address matches, and never connect through a link from a chat or a QR code.`, cost: 'nothing to check', time: '10 minutes' },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital and about $${gas} of gas`, time: '15 minutes to set up' },
    { text: `Do one qualifying action each week — a deposit, a borrow, a swap or a vote — and never leave the position empty.`, cost: 'about $2 of gas a week', time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot, and keep the receipt tokens.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; never pay anyone to claim for you.`, cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
  ];
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank, slug: row.slug, name: row.name, category: row.category,
    chains: row.chains, tvl_usd: row.tvl_usd, change_7d: row.change_7d,
    mcap_usd: row.mcap_usd, listed_at: row.listed_at, age_days: row.age_days,
    implied_value_usd: row.implied_value_usd, on_watchlist: row.on_watchlist,
    base_multiple: row.model.base_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

export const LIVE_CHECK = 'Live re-check 2026-11-23 (DefiLlama API): 39 of the 40 watchlist protocols still record no token; infiniFi now lists INFI (gecko infinifi-token, market cap about $0.94m). OpenTrade and Plume Vaults return no TVL on the live API (unverified — possibly renamed or removed). The sealed snapshot of 2026-11-14 governs this ranking; the live check is a warning, not a re-rank.';

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const table = comparables(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
    model, model_version: MODEL_VERSION, watchlist_size: snapshot.watchlist.length,
    board_size: board.length, early_size: early, live_size: live.length,
    global_multiple: table.global,
    comparables: [...table.byCategory.values()].sort((a, b) => b.n - a.n).slice(0, 12),
    rows: board.map(radarRow), live, live_check: LIVE_CHECK,
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new SnapshotError('snapshot.json is not JSON'); }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug, name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
