// Moonku Radar 5 — a power-law peer valuation for token-radar-01.
//
// The question is what a pre-token protocol's token would be worth if it
// launched today. The answer comes from the 128 protocols in the snapshot
// that already trade: their market caps, plotted against their TVLs in log
// space, do not sit on a line of slope 1. Big protocols carry a smaller
// multiple of TVL than small ones, so a flat multiple overvalues the big
// and undervalues the small. The model fits that slope and prices every
// protocol on its own category's line:
//
//   log(mcap) = a_category + b * log(tvl)
//
//   b            OLS slope of log(mcap) on log(tvl) over the live-token
//                protocols, clamped to [0.30, 0.80]. On this snapshot it
//                lands near 0.52: market cap grows with the square root
//                of TVL, not in proportion to it.
//   a_category   the mean of (log(mcap) - b*log(tvl)) inside the category,
//                shrunk toward the global mean of the same residual with
//                a prior weight of 8 protocols. Thin categories borrow
//                strength from the whole market instead of trusting two
//                or three noisy points.
//   core value   exp(a_category + b * log(tvl)).
//
// A pre-token row is then tilted by a readiness factor built only from the
// snapshot's own figures — momentum against its category peers, log-age
// maturity, and chain breadth — and ranked by core x readiness. Readiness
// never enters the backtest: the backtest scores the valuation core alone,
// predicting each live protocol's market cap from its TVL with that
// protocol left out of the fit (slope refit included).
//
// Leave-one-out backtest, 128 live-token protocols:
//   Moonku Radar 5: MdAPE 85.0%, meanAPE 1386.8%, mean log error 1.582,
//                   32.0% of predictions within 2x of the real market cap.
//   Category-median multiple (the v3 formula, same harness):
//                   MdAPE 91.3%, meanAPE 2147.0%, mean log error 1.801,
//                   25.0% within 2x. The power law wins every column.
//
// No protocol name is ever special-cased: the same functions score every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  slope_min: number;
  slope_max: number;
  shrink_prior: number;
  momentum_cap_pct: number;
  maturity_floor: number;
  maturity_top: number;
  maturity_half_life_days: number;
  breadth_floor: number;
  breadth_step: number;
  breadth_max_chains: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  slope_min: 0.3,
  slope_max: 0.8,
  shrink_prior: 8,
  momentum_cap_pct: 30,
  maturity_floor: 0.85,
  maturity_top: 1.0,
  maturity_half_life_days: 365,
  breadth_floor: 0.92,
  breadth_step: 0.02,
  breadth_max_chains: 4,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'moonku-radar-5';

/** How many pre-token protocols below the watchlist floor the early radar carries. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    slope: number;
    intercept: number;
    core_value_usd: number;
    readiness: number;
    momentum_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  core_value_usd: number;
  readiness: number;
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One leave-one-out backtest point: the model's prediction against the real market cap. */
export interface BenchmarkRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  actual_mcap_usd: number;
  predicted_mcap_usd: number;
  ape_pct: number;
}

/** Everything the dashboard needs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  slope: number;
  global_intercept: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  backtest: { n: number; mdape_pct: number; mean_ape_pct: number; mean_log_err: number; within_2x_pct: number };
  rows: RadarRow[];
  live: LiveRow[];
  benchmark: BenchmarkRow[];
  farm: Record<string, string[]>;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The live-token protocols the valuation is calibrated on: a real market cap over a real TVL. */
export function calibrationSet(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
}

/** The fitted power law: slope, global intercept, and one shrunk intercept per category. */
export interface ValuationFit {
  slope: number;
  globalIntercept: number;
  intercepts: Map<string, number>;
}

/** Ordinary least squares slope of log(mcap) on log(tvl), clamped to the model's band. */
export function fitSlope(protocols: SnapshotProtocol[], model: ModelConstants): number {
  const xs = protocols.map((p) => Math.log(p.tvl_usd));
  const ys = protocols.map((p) => Math.log(p.mcap_usd!));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) * (xs[i]! - mx);
  }
  const raw = den === 0 ? 1 : num / den;
  return Math.min(model.slope_max, Math.max(model.slope_min, raw));
}

function residual(p: SnapshotProtocol, slope: number): number {
  return Math.log(p.mcap_usd!) - slope * Math.log(p.tvl_usd);
}

/** Fit the power law on a calibration set. */
export function fitValuation(protocols: SnapshotProtocol[], model: ModelConstants): ValuationFit {
  const slope = fitSlope(protocols, model);
  const residuals = protocols.map((p) => residual(p, slope));
  const globalIntercept = residuals.reduce((a, b) => a + b, 0) / residuals.length;
  const byCategory = new Map<string, number[]>();
  for (const p of protocols) {
    const key = p.category ?? '';
    const list = byCategory.get(key) ?? [];
    list.push(residual(p, slope));
    byCategory.set(key, list);
  }
  const intercepts = new Map<string, number>();
  for (const [key, list] of byCategory) {
    const mean = list.reduce((a, b) => a + b, 0) / list.length;
    intercepts.set(key, (list.length * mean + model.shrink_prior * globalIntercept) / (list.length + model.shrink_prior));
  }
  return { slope, globalIntercept, intercepts };
}

/** The valuation core for one protocol under a fit: exp(intercept + slope * log TVL). */
export function coreValue(p: SnapshotProtocol, fit: ValuationFit): { core: number; intercept: number } {
  const intercept = fit.intercepts.get(p.category ?? '') ?? fit.globalIntercept;
  return { core: Math.exp(intercept + fit.slope * Math.log(p.tvl_usd)), intercept };
}

/**
 * Readiness: a bounded tilt for the pre-token board, from the snapshot alone.
 * Momentum is the protocol's 7-day TVL change against its own category's
 * median change (a protocol outrunning its peers is readier); maturity
 * saturates with log-age; breadth rewards deployments on more chains.
 */
export function readiness(
  p: SnapshotProtocol,
  age: number | null,
  categoryMedianChange: number,
  model: ModelConstants,
): { readiness: number; momentum: number; maturity: number; breadth: number } {
  const change = finite(p.change_7d, 0);
  const rel = Math.min(model.momentum_cap_pct, Math.max(-model.momentum_cap_pct, change - categoryMedianChange));
  const momentum = 1 + rel / 100;
  const ageForModel = age ?? model.unknown_age_days;
  const maturity =
    model.maturity_floor +
    (model.maturity_top - model.maturity_floor) * (1 - Math.exp(-ageForModel / model.maturity_half_life_days));
  const breadth =
    model.breadth_floor + model.breadth_step * Math.min(p.chains.length, model.breadth_max_chains);
  return { readiness: momentum * maturity * breadth, momentum, maturity, breadth };
}

/** Median of numbers, 0 for an empty list. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 300;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateralized')) return `Lend $${capital} of USDC through ${name} on ${chain} and leave the deposit earning.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Add $${capital} of liquidity to the deepest pool on ${name} (${chain}) and leave it in place.`;
  if (c.includes('bridge')) return `Move $${capital} of USDC across ${name} to ${chain} and put the bridged funds to work there.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} through ${name}, keep the receipt token, and do not unstake early.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Post $${capital} of USDC as collateral on ${name} and open a single small hedged trade.`;
  if (c.includes('prediction')) return `Back one outcome with $${capital} on ${name} and let the market settle.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return `Place $${capital} into a ${name} vault on ${chain} and hold the vault shares.`;
  if (c.includes('stable')) return `Mint or lock $${capital} of stable value through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Take $${capital} of the yield-bearing asset ${name} issues on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  return `Put $${capital} of USDC to work inside ${name} on ${chain} and leave the position open.`;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
function stepText(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains,
 * TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    stepText(
      'Open a fresh wallet that holds only the funds you plan to farm, and store its recovery phrase offline on paper.',
      'under $3 of gas for the first transaction',
      '5 minutes',
    ),
    stepText(action, `$${capital} of capital and about $${capital >= 200 ? 8 : 4} of gas`, '15 minutes to set up'),
    stepText(
      'Do one real action every week — a deposit, a borrow, a swap or a vote — so the wallet reads as an active user.',
      'about $2 of gas a week',
      '10 minutes a week',
    ),
    stepText(
      `Keep the position untouched for at least ${hold} days so it is counted in more than one snapshot of activity.`,
      `the $${capital} stays in the position`,
      `${hold} days`,
    ),
    stepText(
      'Before withdrawing, open the protocol\u2019s own points or rewards page and claim only from the link that page itself publishes.',
      'free to check, and never pay anyone to claim',
      '10 minutes',
    ),
    stepText(
      'Record the wallet, the dates and every transaction hash in a farm log, so the position can be repeated or unwound.',
      'nothing but the log',
      '5 minutes',
    ),
  ];
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The leave-one-out backtest: each live protocol predicted with itself left out of the fit. */
export function backtest(snapshot: Snapshot, model: ModelConstants = MODEL): {
  rows: BenchmarkRow[];
  mdape_pct: number;
  mean_ape_pct: number;
  mean_log_err: number;
  within_2x_pct: number;
} {
  const cal = calibrationSet(snapshot);
  const rows: BenchmarkRow[] = [];
  for (const p of cal) {
    const others = cal.filter((q) => q !== p);
    const fit = fitValuation(others, model);
    const { core } = coreValue(p, fit);
    const predicted = Math.max(1, Math.round(core));
    const ape = Math.abs(predicted - p.mcap_usd!) / p.mcap_usd!;
    rows.push({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      actual_mcap_usd: p.mcap_usd!,
      predicted_mcap_usd: predicted,
      ape_pct: round4(ape * 100),
    });
  }
  const apes = rows.map((r) => r.ape_pct / 100);
  const logs = rows.map((r) => Math.abs(Math.log(r.predicted_mcap_usd / r.actual_mcap_usd)));
  const sorted = [...apes].sort((a, b) => a - b);
  const mdape = sorted.length % 2 === 1 ? sorted[Math.floor(sorted.length / 2)]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
  return {
    rows,
    mdape_pct: round4(mdape * 100),
    mean_ape_pct: round4((apes.reduce((a, b) => a + b, 0) / apes.length) * 100),
    mean_log_err: round4(logs.reduce((a, b) => a + b, 0) / logs.length),
    within_2x_pct: round4(
      (rows.filter((r) => r.predicted_mcap_usd / r.actual_mcap_usd >= 0.5 && r.predicted_mcap_usd / r.actual_mcap_usd <= 2).length / rows.length) * 100,
    ),
  };
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const fit = fitValuation(calibrationSet(snapshot), model);
  const categoryChange = new Map<string, number>();
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    const key = p.category ?? '';
    const list = categoryChange.get(key) ?? [];
    if (p.change_7d !== null) list.push(p.change_7d);
    categoryChange.set(key, list);
  }
  const medianChange = new Map<string, number>();
  for (const [key, list] of categoryChange) medianChange.set(key, median(list));

  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const scored = (p: SnapshotProtocol) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const { core, intercept } = coreValue(p, fit);
    const r = readiness(p, age, medianChange.get(p.category ?? '') ?? 0, model);
    return { p, age, core, intercept, r, implied: Math.max(1, Math.round(core * r.readiness)) };
  };
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .map(scored)
    .sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const e of early) chosen.set(e.p.slug, e.p);

  const ranked = [...chosen.values()]
    .map(scored)
    .sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return ranked.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      slope: round4(fit.slope),
      intercept: round4(s.intercept),
      core_value_usd: Math.max(1, Math.round(s.core)),
      readiness: round4(s.r.readiness),
      momentum_multiplier: round4(s.r.momentum),
      maturity_multiplier: round4(s.r.maturity),
      breadth_multiplier: round4(s.r.breadth),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const bt = backtest(snapshot, model);
  const fit = fitValuation(calibrationSet(snapshot), model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    slope: round4(fit.slope),
    global_intercept: round4(fit.globalIntercept),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    backtest: {
      n: bt.rows.length,
      mdape_pct: bt.mdape_pct,
      mean_ape_pct: bt.mean_ape_pct,
      mean_log_err: bt.mean_log_err,
      within_2x_pct: bt.within_2x_pct,
    },
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      mcap_usd: r.mcap_usd,
      listed_at: r.listed_at,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      core_value_usd: r.model.core_value_usd,
      readiness: r.model.readiness,
      watchlist: snapshot.watchlist.includes(r.slug),
    })),
    live,
    benchmark: bt.rows,
    farm: Object.fromEntries(board.map((r) => [r.slug, r.farm_steps])),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
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
      slug: p.slug,
      name: p.name,
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
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
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

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
