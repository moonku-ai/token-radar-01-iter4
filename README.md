[![Prize $1,325](https://img.shields.io/badge/prize-%241%2C325_USDC-brightgreen)](https://make.fun/bounty/token-radar-01)
[![Board 200 rows](https://img.shields.io/badge/board-200_rows-blue)](https://make.fun/bounty/token-radar-01)
[![Backtest MdAPE 85.0%](https://img.shields.io/badge/backtest-MdAPE_85.0%25-orange)](https://make.fun/bounty/token-radar-01)

# Moonku Radar 5 — token-radar-01

A token launch radar: a board of pre-token protocols ranked by implied value, with a
farm plan for each one. Entry for make.fun's `token-radar-01` bounty ($1,325 USDC).

## The model (moonku-radar-5)

```text
log(market cap) = a_category + b · log(TVL)
implied value   = exp(a_category + b · log TVL) × readiness
```

- **Power law, not a flat multiple.** Across the 128 protocols in the snapshot that
  already trade, market cap grows with the square root of TVL, not in proportion to
  it — a flat multiple overvalues the big and undervalues the small. `b` is the
  least-squares slope of log(market cap) on log(TVL) over the live-token protocols,
  clamped to [0.30, 0.80] (0.52 on this snapshot). Each category's intercept is its
  mean residual shrunk toward the global mean with a prior weight of 8 protocols, so
  thin categories borrow strength from the whole market.
- **Readiness.** Momentum (the protocol's 7-day TVL change against its own category's
  median change, capped at ±30 points) × maturity (saturating with age, 0.85–1.00) ×
  chain breadth (0.92–1.00). Bounded, monotone in the snapshot's own figures, and it
  never enters the backtest.
- **Board.** All 40 watchlist protocols plus the 160 highest-implied pre-token
  protocols below the watchlist floor — 200 rows. Token-bearing protocols never enter
  the ranking; they are the calibration set, and the dashboard's benchmark shows the
  model's leave-one-out prediction against each one's real market cap.

## Backtest (leave-one-out, 128 token-bearing protocols)

Predicting each live protocol's market cap from its TVL, with that protocol left out
of the fit (slope refit included):

| Estimator | Median error | Mean error | Mean log error | Within 2× |
| --- | --- | --- | --- | --- |
| Flat category median (v3 formula, same harness) | 91.3% | 2147.0% | 1.801 | 25.0% |
| **Power law, slope fitted, shrink 8 (v4)** | **85.0%** | **1386.8%** | **1.582** | **32.0%** |

The power law wins on every column: median error down 6.3 points, mean error down
35%, mean log error down 12.2%, and 32.0% of live market caps land within 2× of the
prediction (v3: 25.0%).

## Run it

Node 22, standard library only — nothing to install:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

Writes `out/board.json` (the ranked board), `out/data.js` (the dashboard's data),
`out/dashboard/` (the page), `out/screenshots/` (three renders of the page) and
`out/dossier.json` (the judge's dossier, via the vendored `vendor/makefun-board.ts`).
Two runs on the same snapshot write the same bytes.

## Files

- `main.ts` — the program: snapshot in, board + dashboard + dossier out.
- `lib/model.ts` — the model, the farm-plan generator, the board builder, the snapshot parser.
- `dashboard/` — the page: `index.html`, `app.css`, `app.js` (sortable, filterable,
  detail view per protocol, live-token benchmark; no network).
- `screenshots/` — three renders of the dashboard at 1440×900: the board, a protocol's
  detail view, a filtered view.
- `vendor/makefun-board.ts` — the kit's dossier library, byte for byte as shipped.

## Notes

A protocol is called pre-token when its record carries no token — no market cap, no
CoinGecko id, no symbol. That is the record's word, not proof. The board is the entry's
own claim about what a token would be worth if the protocol's record stayed as it is;
it never predicts whether or when a token launches.
