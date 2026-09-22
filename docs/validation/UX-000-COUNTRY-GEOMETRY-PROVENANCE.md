# Bundled country geometry provenance

Verified2026-09-20; geometry bytes unchanged.

Local asset:public/data/countries.geojson;214419bytes;258 features.
SHA256:`195417e48173736983685bd1bfce91c6a8a28a63a7fea6ffa036191f354617b1`.
Git blob:`2e1453c73607a0af54625bdc410fa798e3b40e78`.
Same blob in upstream-history commit24b5188db967722a53c03cb2232fda0d552404f7,
which corrects France/Norway/Kosovo identifiers; initially introduced in
1292f0595f48ae4c10775a9b912ddeb0b1f809ee. Those commits alone do not establish
original geographic authorship.

## Independent source comparison

Downloaded and parsed [pinned datasets/geo-countries GeoJSON](https://raw.githubusercontent.com/datasets/geo-countries/185beb1137f6e9f5d916c91916f0159c20fbab30/data/countries.geojson).
Upstream commit:`185beb1137f6e9f5d916c91916f0159c20fbab30`.
Downloaded body SHA256:`45f41865adec4f86602c2cd05c0e29cd8b437614bf2f5b5a863d12463202cae4`.
Upstream also has258 features. Matched by country name, every retained local
coordinate pair exists exactly in that country's upstream geometry:7035/7035
unique-within-country pairs;258/258 features matched, including empty geometries;
zero exceptions. This establishes shared geometry, not a claim that the exact
historical simplification command has been recovered. Preserve existing local
geometry and identifier corrections.

The [dataset documentation](https://github.com/datasets/geo-countries/tree/185beb1137f6e9f5d916c91916f0159c20fbab30)
identifies Natural Earth as its data source and dedicates the packaged data under
[ODC PDDL](https://opendatacommons.org/licenses/pddl/1-0/).
[Natural Earth's terms](https://www.naturalearthdata.com/about/terms-of-use/)
state that its vector/raster map data is public domain and may be modified and
redistributed. Credit the baseline to Natural Earth and datasets/geo-countries.
Do not claim this coarse geography provides navigation-grade detail.

External evidence retained under `~/.crystalball-diagnostics/ux000-map-20260920/`:
upstream-countries.geojson and provenance-comparison.json. No credential, runtime
provider request or production asset replacement was involved in this check.
