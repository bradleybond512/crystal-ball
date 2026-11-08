# OG dependency distribution boundary

The marketing application currently serves a static `public/og.png`. It does
not define a dynamic OG endpoint. Qualification uses separate private Node and
Workers fixtures, not an application route. A successful fixture does not imply
that its fonts/WASM or all development dependencies are distributed by this site.

The compatible Vinext update is MIT licensed. Its emitted user-agent shim also
contains bundled ua-parser-js 1.0.35. Retain the exact upstream
`THIRD_PARTY_LICENSES.md` text (Faisal Salman MIT notice) alongside Vinext LICENSE;
`public/third-party/vinext-THIRD_PARTY_LICENSES.txt` supplies that unchanged text. Its actual complete package
license and immutable source pointer are retained in `public/third-party/` for
inclusion in final rebuilt site output, which must be verified to carry the notice for the Vinext runtime it includes.

Before redistributing a dynamic OG fixture or adding such an application route,
retain the following actual licenses and identify the emitted covered source:

| Package | Actual license and source |
| --- | --- |
| `@vercel/og` 1.0.3 | MPL-2.0, package LICENSE. Registry declares source `vercel/og` at `0dcef33bbd36555b070bb9d293991a86edb97c34`, but immutable GitHub tree lookup returned 404. The official package ships full source contents in both 210-source maps, including original OG TypeScript. Preserve that available source and MPL text; completeness for reproduction and original Git identity remain unverified. |
| `satori` 0.33.5 | MPL-2.0, package LICENSE; https://github.com/vercel/satori/tree/26a52affc031216fee5882b6e965c8dbc7ac1782 |
| `@resvg/resvg-wasm` 2.4.1 | MPL-2.0; npm omits LICENSE (also in 2.4.0). Recover full license from https://github.com/yisibl/resvg-js/blob/2347b417e1955a6954223f1c17b815e177a01765/LICENSE and preserve covered-source availability. |
| `harfbuzzjs` 0.10.0 | Actual LICENSE specifies Apache for Zephyr libc and Emscripten emmalloc, MIT for the remainder. Source: https://github.com/harfbuzz/harfbuzzjs/tree/c39f7aef5347b1541c3c923f5edac4671d51c558 . Preserve that mixed notice, full applicable Apache text and any applicable component notices, not merely npm's MIT label. |
| `fflate` 0.7.5 | MIT; preserve package LICENSE if redistributed. The scoped Satori override retains this fixed version. |
| `css-gradient-parser` 0.0.17 | MIT; preserve package LICENSE if redistributed. |

The actual packaged Geist-Regular.ttf used in tests has SHA256
`bde046ddd9f20be35b0bd56cc79eb752b967fb6661a3fe76cb067bb09f871d76`.
The exact font's embedded name table explicitly identifies SIL Open Font License
1.1 and Copyright 2024 The Geist Project Authors. The full official OFL text with
that copyright is available at
https://github.com/vercel/geist-font/blob/91158e012bdc4abd59fa066d0eae9fc11c2c9f24/OFL.txt .
Retain this font-specific notice and text if distributing the font, not HarfBuzz's
Noto OFL notice. The OG archive has no separate font license file. Checked Geist
1.8.0/1.8.1/1.8.2 release font blobs do not exactly match the packaged font;
exact source-build equivalence remains unverified despite identified licensing.
The WOFF test converts the installed Geist font
in memory; no font bytes are vendored into this repository.

This document is an explicit distribution checklist, not a statement that all
OG/font obligations have been satisfied. Keep private fixture output private
until its actual asset/notice manifest is qualified. Do not copy all dependency
assets into public output to satisfy a checklist.
