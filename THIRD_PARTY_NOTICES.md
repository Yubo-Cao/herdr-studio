# Third-Party Notices

Roamgate includes or renders assets from third-party projects. Those assets
remain under their original licenses and are not relicensed by the project
MIT license.

## Roamgate artwork

The Roamgate bird, wordmark, icons, and social images were supplied by the
project owner. They are not Herdr's official logo. The small application marks
are resized exports of that artwork, displayed on a warm-white background.

## Nerd Fonts

`web/src/assets/herdr-nerd-symbols.woff2` is a glyph-only derivative of
[Nerd Fonts](https://github.com/ryanoasis/nerd-fonts). Nerd Fonts combines
glyph sources under several licenses; the bundled font remains subject to the
upstream licensing terms documented in
[`LICENSES/NERD-FONTS.txt`](./LICENSES/NERD-FONTS.txt) and the upstream
[license audit](https://github.com/ryanoasis/nerd-fonts/blob/master/license-audit.md).

## JetBrains Mono

The terminal's bundled "Roamgate Mono" face is
[JetBrains Mono](https://github.com/JetBrains/JetBrainsMono), distributed through
the `@fontsource-variable/jetbrains-mono` package. Copyright 2020 The JetBrains
Mono Project Authors, licensed under the SIL Open Font License 1.1; see
[`LICENSES/JETBRAINS-MONO.txt`](./LICENSES/JETBRAINS-MONO.txt).

## Lobe Icons

Agent brand icons imported from `@lobehub/icons-static-svg` are provided by
[Lobe Icons](https://github.com/lobehub/lobe-icons), Copyright (c) 2023
LobeHub, under the MIT License. See
[`LICENSES/LOBE-ICONS.txt`](./LICENSES/LOBE-ICONS.txt). The static website
vendors the same Codex and Kimi SVGs as `site/assets/codex.svg` and
`site/assets/kimi.svg` so it does not need a package install or icon CDN.

## Monaco Editor

The file editor bundles [Monaco Editor](https://github.com/microsoft/monaco-editor),
Copyright (c) Microsoft Corporation, under the MIT License, including its
Codicons icon font, which Microsoft publishes under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The package's
`ThirdPartyNotices.txt` lists the components Monaco itself redistributes.

## Pi

`web/src/assets/pi-logo.svg` is adapted from the
[Pi press kit](https://pi.dev/press-kit), which publishes its assets under the
MIT License. See [`LICENSES/PI.txt`](./LICENSES/PI.txt). The static website
uses a copy at `site/assets/pi.svg`.

When updating these website icons, copy them from the application sources
used by `web/src/components/AgentIcon.tsx`. The deployed site includes their
notices in `site/assets/agent-icons-LICENSE.txt`.

## WebRTC VAD

Voice activity detection runs the WebRTC voice activity detector through
[libfvad](https://github.com/dpirch/libfvad), compiled to WebAssembly by
[`@echogarden/fvad-wasm`](https://github.com/echogarden-project/fvad-wasm).
It is Copyright (c) 2011, The WebRTC project authors, under the BSD 3-Clause
License. See [`LICENSES/WEBRTC-VAD.txt`](./LICENSES/WEBRTC-VAD.txt).

## Trademarks

Herdr, Pi, Codex, Claude, Gemini, Kimi, Grok, and other product names and logos
are trademarks of their respective owners. Their appearance identifies
compatible tools and does not imply endorsement of Roamgate.

JavaScript dependencies retain the licenses declared by their respective
packages.
