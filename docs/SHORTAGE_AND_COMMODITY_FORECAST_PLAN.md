# Shortage and Commodity Forecast Plan

Use this plan to make Crystal Ball more predictive around food shortages, crop failures, oil/fuel shortages, and broader commodity stress.

The goal is to predict shortage risk before it is obvious in headlines.

## Core Forecast Pattern

Most shortage forecasts can use the same structure:

```text
production risk + inventory risk + transport risk + demand shock + price confirmation + conflict/weather overlay = forecast
```

Crystal Ball should not only collect the raw data. It should explain which part of the shortage chain is breaking.

## Food Shortage Forecast Engine

Track crop failure and food security risk before food prices spike.

Core signals:

- Crop condition
- Drought
- Heat
- Frost
- Flood
- Soil moisture
- NDVI and vegetation stress
- Weather anomaly vs crop calendar stage
- Planting delays
- Harvest disruption
- Fertilizer prices
- Fuel prices
- Export bans
- Port disruption
- Conflict corridors
- Refugee flows
- Currency collapse
- Local food price inflation
- IPC, FEWS NET, WFP, and humanitarian confirmation

Useful sources:

- USDA Quick Stats: <https://www.nass.usda.gov/quick_stats/>
- FAOSTAT: <https://www.fao.org/statistics/databases/en/>
- FEWS NET Data Center: <https://fews.net/data>
- FEWS NET API help: <https://help.fews.net/fde/fews-net-api>
- USGS Water APIs: <https://api.waterdata.usgs.gov/>
- NOAA Climate Data Online API: <https://www.ncdc.noaa.gov/cdo-web/webservices/v2>
- Drought.gov data downloads: <https://www.drought.gov/data-download>

Example forecast:

```text
Wheat shortage risk rising in Region X:
- rainfall 42% below normal during key growth window
- soil moisture below 10th percentile
- fertilizer prices rising
- export corridor disrupted
- local wheat prices up 18% month-over-month
- FEWS NET classification deteriorating nearby
```

## Oil Shortage and Fuel Stress Forecast Engine

Oil shortages are usually visible through inventory drawdown, refinery disruption, shipping chokepoints, conflict risk, sanctions, and demand spikes.

Core signals:

- Crude inventories
- Product inventories
- Days of supply
- Refinery utilization
- Refinery outages
- Imports
- Exports
- Strategic reserve releases
- Tanker traffic and rerouting
- Port closures
- Sanctions
- Conflict
- Crack spreads
- Product prices
- Weather disruption to Gulf/refinery regions

Useful sources:

- EIA petroleum data: <https://www.eia.gov/petroleum/data.php>
- EIA Open Data petroleum API: <https://www.eia.gov/opendata/index.php/browser/petroleum/>
- JODI Oil: <https://www.jodidata.org/oil/>
- JODI Oil user guide: <https://www.jodidata.org/oil/support/user-guide.aspx>
- IEA Oil Information: <https://www.iea.org/data-and-statistics/data-product/oil-information>
- World Bank commodity markets/Pink Sheet: <https://www.worldbank.org/en/research/commodity-markets>

Example forecast:

```text
Diesel stress risk rising:
- distillate inventories below 5-year range
- refinery utilization falling
- imports down week-over-week
- port weather risk increasing
- freight demand stable/rising
- diesel crack spread widening
```

## Commodity Playbooks

Do not build one generic shortage model. Build commodity playbooks with shared scoring primitives.

Food commodities:

- Wheat
- Corn
- Rice
- Soybeans
- Sugar
- Coffee
- Cocoa
- Fertilizer

Energy commodities:

- Crude oil
- Gasoline
- Diesel
- Jet fuel
- Natural gas
- Propane
- Electricity capacity

Each playbook should define:

- Leading indicators
- Confirming indicators
- Invalidating indicators
- Normal seasonal cycle
- Known chokepoints
- Affected countries
- Affected sectors
- Forecast horizon

## Leading Indicator Scores

For each commodity, compute:

- Production Risk: 0-100
- Inventory Risk: 0-100
- Transport Risk: 0-100
- Policy Risk: 0-100
- Demand Shock: 0-100
- Price Confirmation: 0-100
- Overall Shortage Risk: weighted score

Example:

```text
Global Wheat Shortage Risk: 71
Production risk: 82
Transport risk: 65
Policy risk: 58
Price confirmation: 49
Confidence: medium
Watch window: 30-90 days
```

## Watch Windows

For every shortage forecast, define what should happen next if the forecast is right.

Example:

```text
If wheat shortage risk is real, expect within 30 days:
- crop condition downgrade
- local wheat prices rising
- export restriction rumors or policy moves
- WFP/FEWS NET deterioration
- futures curve tightening
```

If those signals do not appear, confidence should decay.

## Cross-Domain Insight Engine

Shortages are almost never single-domain. Crystal Ball should combine:

```text
weather + crop calendar + river levels + fertilizer + conflict + port status + prices + humanitarian data
```

Examples:

- Drought + low river levels + fertilizer spike = crop failure risk
- Conflict + Black Sea port disruption + wheat futures rise = grain export risk
- Hurricane + refinery corridor + low distillate stocks = diesel/gasoline shortage risk
- Heat wave + grid demand + low natural gas storage = electricity/fuel stress
- Cyberattack + pipeline/refinery target + fuel price movement = supply disruption risk

## Insight Products

Build these user-facing intelligence surfaces after the model exists:

- Shortage Radar: ranked list of commodities at risk
- Food Security Map: crop stress + IPC/FEWS NET + price pressure
- Energy Stress Map: inventories + refinery/port/weather/conflict chokepoints
- Commodity Watch Cards: what changed, why it matters, what to watch
- Cascade Forecasts: crop failure -> food prices -> unrest risk
- Confidence Timeline: how the forecast strengthened or weakened over time
- Data Gap Warnings: low confidence because current inventory data is missing

## First Implementation Batch

Add a shared shortage forecast framework first.

Suggested type:

```ts
type ShortageDomain = 'food' | 'energy' | 'fertilizer' | 'water';

interface ShortageForecast {
  commodity: string;
  domain: ShortageDomain;
  region: string;
  horizonDays: number;
  riskScore: number;
  confidence: 'low' | 'medium' | 'high';
  drivers: ShortageDriver[];
  confirmingIndicators: string[];
  invalidatingIndicators: string[];
  dataGaps: string[];
  lastUpdated: string;
}
```

Then implement two initial deterministic models:

- `wheat-shortage-risk`
- `diesel-shortage-risk`

Suggested files:

- `src/services/shortage/shortage-types.ts`
- `src/services/shortage/shortage-score.ts`
- `src/services/shortage/commodity-playbooks.ts`
- `src/services/shortage/wheat-shortage-risk.ts`
- `src/services/shortage/diesel-shortage-risk.ts`
- `src/services/shortage/__tests__/shortage-score.test.mts`
- `src/services/shortage/__tests__/commodity-playbooks.test.mts`

## Guardrails

- Start deterministic.
- Do not add opaque ML in the first batch.
- Every shortage score must include drivers and data gaps.
- Every forecast must include confirming and invalidating indicators.
- Use source provenance for all inputs.
- Make stale or missing data reduce confidence.
- Keep model outputs stable enough for unit tests.
- Do not overfit to one country or one data provider.

## Claude Instruction

Claude should read this plan before implementation.

Recommended prompt:

```text
Read docs/SHORTAGE_AND_COMMODITY_FORECAST_PLAN.md. Implement the first batch only: shared shortage forecast types, scoring helpers, commodity playbooks, and deterministic wheat/diesel risk models with unit tests. Do not build broad UI yet.
```
