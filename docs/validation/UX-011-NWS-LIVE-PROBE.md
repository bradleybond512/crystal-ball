# UX-011 NWS live probe

Probe time: `2026-08-30T06:56:38Z`

Requests used no credentials:

- `GET https://api.weather.gov/alerts/active`
- `GET https://api.weather.gov/points/41.6,-86.7`
- Headers: `User-Agent: CrystalBall/1.0 (UX-011 live probe)`, `Accept: application/geo+json`

## Active alerts body

The body was a GeoJSON `FeatureCollection` with top-level keys `@context`,
`features`, `title`, `type`, and `updated`. It contained 266 feature rows. Each
feature had `geometry`, `id`, `properties`, and `type` at the top level.

The provider consumes `id`, `geometry.type`, `geometry.coordinates`, and these
nested `properties` fields: `status`, `messageType`, `event`, `severity`,
`headline`, `description`, `areaDesc`, `sent`, `effective`, `onset`, `expires`,
and `geocode.UGC`.

One live row had this consumed shape:

```json
{
  "id": "https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.3b8453e952796ba985df8499433075c21a578b16.001.1",
  "geometry": { "type": "Polygon", "coordinates": "nested rings" },
  "properties": {
    "status": "Actual",
    "messageType": "Alert",
    "event": "Severe Thunderstorm Warning",
    "severity": "Severe",
    "sent": "2026-08-30T01:51:00-05:00",
    "effective": "2026-08-30T01:51:00-05:00",
    "onset": "2026-08-30T01:51:00-05:00",
    "expires": "2026-08-30T02:30:00-05:00",
    "geocode": { "UGC": ["NEC019", "NEC077", "NEC093", "NEC163", "NEC175"] }
  }
}
```

Observed distributions:

- Geometry: 8 `Polygon`, 258 `null`; 8 total areas, 8 rings, 91 coordinate
  pairs (vertices).
- Geometry per feature: 1 area, 1 ring, 6–20 vertices.
- `properties.geocode`: object on all 266 rows.
- `properties.geocode.UGC`: array on all 266 rows; 1–17 codes per row, 465 total.
- Status: 265 `Actual`, 1 `Test`.
- Message type: 217 `Alert`, 49 `Update`.
- Severity: 221 `Minor`, 23 `Moderate`, 17 `Severe`, 5 `Unknown`.

The response-wide caps (512 areas, 2,048 rings, 250,000 vertices) are 64x,
256x, and more than 2,740x this captured batch respectively. They bound hostile
or drifted bodies while leaving substantial headroom above the live distribution.

## Point jurisdiction body

The body was one GeoJSON `Feature` with top-level keys `@context`, `geometry`,
`id`, `properties`, and `type`. The provider consumes all three jurisdiction
fields below; a covered result requires all three to be present and valid.

```json
{
  "properties": {
    "forecastZone": "https://api.weather.gov/zones/forecast/INZ103",
    "county": "https://api.weather.gov/zones/county/INC091",
    "fireWeatherZone": "https://api.weather.gov/zones/fire/INZ103"
  }
}
```

The live result normalizes deterministically to zones `INZ103` and `INC091`
while retaining field-level proof that forecast, county, and fire-weather
jurisdictions were all supplied. Retrieval time and a 30-minute validity bound
are attached by the adapter. A malformed HTTP-200 body throws; a 404 is the only
explicit `outside-jurisdiction` result.
