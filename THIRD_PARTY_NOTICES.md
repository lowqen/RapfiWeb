# Third-Party Notices

Zenyth Web as a whole is distributed under the **GNU General Public License v3.0 or later**
(see [`LICENSE`](LICENSE)), because the deployed bundle contains the Rapfi engine.
Code written for this repository may additionally be used under the BSD 2-Clause License.

This file lists what is bundled or ported, and the notices each license requires.
The same notices (license terms, no-warranty statement, component list and engine source) are
shown inside the app under **Settings ▸ About**.

| Component | Where | Upstream | License |
|---|---|---|---|
| **Rapfi engine** (WebAssembly build) | `public/engine/*.js`, `public/engine/*.wasm` | [dhbloo/rapfi](https://github.com/dhbloo/rapfi) | GPL-3.0-or-later |
| **Rapfi networks** (`rapfi.data`, renju weights) | release asset, served at `/engine/rapfi.data` | [dhbloo/rapfi-networks](https://github.com/dhbloo/rapfi-networks) | CC0 1.0 |
| **Yixin-Board** (ported logic: engine protocol, position keys, opening frame keys, desktop settings layout, review classifier) | `src/core/**` | [accreator/Yixin-Board](https://github.com/accreator/Yixin-Board) → [dhbloo/Yixin-Board](https://github.com/dhbloo/Yixin-Board) | BSD 2-Clause, © 2009–2017 Kai Sun |
| **Zenyth** (ported Kotlin logic) | `src/core/**` | [lowqen/Zenyth](https://github.com/lowqen/Zenyth) | BSD 2-Clause, © 2026 lowqen |
| React, React DOM | npm | [facebook/react](https://github.com/facebook/react) | MIT |
| React Router | npm | [remix-run/react-router](https://github.com/remix-run/react-router) | MIT |
| Zustand | npm | [pmndrs/zustand](https://github.com/pmndrs/zustand) | MIT |
| Dexie.js | npm | [dexie/Dexie.js](https://github.com/dexie/Dexie.js) | Apache-2.0 |
| **Pretendard** (variable, dynamic-subset WOFF2; the CSS carries the copyright header) | npm, bundled under `assets/` | [orioncactus/pretendard](https://github.com/orioncactus/pretendard) | SIL OFL 1.1, © 2021 Kil Hyung-jin, with Reserved Font Name Pretendard |

Build and test tooling (Vite, TypeScript, Vitest, ESLint, Prettier, Playwright, Emscripten) is
not shipped in the bundle.

## Rapfi: corresponding source

The engine binaries in `public/engine/` are built by
[`tools/build_engine_wasm.sh`](tools/build_engine_wasm.sh) from upstream `dhbloo/rapfi` at the
commit recorded in [`public/engine/ENGINE_VERSION.txt`](public/engine/ENGINE_VERSION.txt), with
the patches listed there applied from [`tools/patches/`](tools/patches). Together with this
repository, that is the complete corresponding source. The GitHub Actions workflow
`engine-release.yml` reproduces the build.

## Yixin-Board: BSD 2-Clause notice

```
Copyright (c) 2009-2017, Kai Sun
All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

  Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

  Redistributions in binary form must reproduce the above copyright notice, this
  list of conditions and the following disclaimer in the documentation and/or
  other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

The Yixin **engine** (`Yixin.exe`) is closed-source and is **not** part of Zenyth Web. Only the
open-source Yixin-Board GUI was used as a reference.

## RenjuNet data is never bundled

RenjuNet game archives (`.rif`) are licensed for non-commercial, offline use only. Zenyth Web
does not ship, download or upload them: the user drops their own copy into the app and the
statistics stay in that browser's IndexedDB. `.gitignore` and a CI gate (`web.yml`,
`deploy.yml`) keep `*.rif`, `*.pack`, `freq_data.json` and `renju*.sqlite` out of the
repository and out of every deployed build.
