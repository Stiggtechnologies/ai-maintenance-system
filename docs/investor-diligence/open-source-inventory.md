# Open-source dependency inventory

This inventory is generated deterministically from `package-lock.json` by
`scripts/compliance/generate-license-inventory.mjs`. It is technical
diligence evidence, not a legal opinion.

- Lockfile SHA-256: `79252cc63db23fcdac5fec4a1d8a00f6cbf94d5fdb7e186bc081a69b517cce16`
- Package instances: **417**
- Direct production dependencies: **14**
- Direct development dependencies: **26**
- Prohibited-license matches: **0**
- Missing license metadata: **0**
- Machine-readable inventory: `open-source-inventory.json`

## Policy result

The automated baseline rejects missing license metadata and identifiers that
match AGPL, GPL, LGPL, SSPL, BUSL/BSL, Elastic-2.0, or Commons Clause. MPL,
font, and attribution licenses are retained for manual notice review. Passing
this check does not replace counsel review of bundled assets, transitive terms,
patents, trademarks, or customer distribution obligations.

## License summary

| License | Package instances | Baseline treatment |
| --- | ---: | --- |
| 0BSD | 1 | Permitted by automated baseline |
| Apache-2.0 | 25 | Permitted by automated baseline |
| BlueOak-1.0.0 | 2 | Permitted by automated baseline |
| BSD-2-Clause | 10 | Permitted by automated baseline |
| BSD-3-Clause | 4 | Permitted by automated baseline |
| CC-BY-4.0 | 1 | Manual notice review |
| CC0-1.0 | 1 | Permitted by automated baseline |
| ISC | 22 | Permitted by automated baseline |
| MIT | 323 | Permitted by automated baseline |
| MIT-0 | 2 | Permitted by automated baseline |
| MPL-2.0 | 24 | Manual notice review |
| OFL-1.1 | 2 | Manual notice review |

## Direct dependencies

| Package | Version | Scope | License |
| --- | --- | --- | --- |
| @eslint/js | 10.0.1 | development | MIT |
| @fontsource-variable/inter | 5.3.0 | production | OFL-1.1 |
| @fontsource-variable/jetbrains-mono | 5.3.0 | production | OFL-1.1 |
| @playwright/test | 1.62.1 | development | Apache-2.0 |
| @supabase/supabase-js | 2.112.3 | production | MIT |
| @tailwindcss/postcss | 4.3.3 | development | MIT |
| @tailwindcss/vite | 4.3.3 | development | MIT |
| @testing-library/jest-dom | 6.9.1 | development | MIT |
| @testing-library/react | 16.3.3 | development | MIT |
| @types/node | 24.13.3 | development | MIT |
| @types/qrcode | 1.5.6 | production | MIT |
| @types/react-dom | 19.2.5 | development | MIT |
| @types/react | 19.2.18 | development | MIT |
| @vitejs/plugin-react | 6.1.1 | development | MIT |
| eslint-plugin-react-hooks | 7.1.1 | development | MIT |
| eslint-plugin-react-refresh | 0.5.5 | development | MIT |
| eslint | 10.9.1 | development | MIT |
| fflate | 0.8.3 | production | MIT |
| framer-motion | 12.43.0 | production | MIT |
| globals | 17.11.0 | development | MIT |
| husky | 9.1.7 | development | MIT |
| jsdom | 29.1.1 | development | MIT |
| lint-staged | 17.4.1 | development | MIT |
| lucide-react | 1.33.0 | production | ISC |
| pdfjs-dist | 4.10.38 | production | Apache-2.0 |
| postcss | 8.5.26 | development | MIT |
| prettier | 3.9.6 | development | MIT |
| qrcode | 1.5.4 | production | MIT |
| react-dom | 19.2.8 | production | MIT |
| react-router-dom | 7.18.2 | production | MIT |
| react | 19.2.8 | production | MIT |
| tailwindcss | 4.3.3 | development | MIT |
| terser | 5.51.2 | development | BSD-2-Clause |
| tesseract.js | 5.1.1 | production | Apache-2.0 |
| tsx | 4.23.13 | development | MIT |
| typescript-eslint | 8.68.0 | development | MIT |
| typescript | 5.9.3 | development | Apache-2.0 |
| vite | 8.2.2 | development | MIT |
| vitest | 4.1.11 | development | MIT |
| zustand | 5.0.15 | production | MIT |

## Manual notice review queue

| Package | Version | License | Scope |
| --- | --- | --- | --- |
| @fontsource-variable/inter | 5.3.0 | OFL-1.1 | production |
| @fontsource-variable/jetbrains-mono | 5.3.0 | OFL-1.1 | production |
| caniuse-lite | 1.0.30001809 | CC-BY-4.0 | transitive |
| lightningcss-android-arm64 | 1.32.0 | MPL-2.0 | transitive |
| lightningcss-android-arm64 | 1.33.0 | MPL-2.0 | transitive |
| lightningcss-darwin-arm64 | 1.32.0 | MPL-2.0 | transitive |
| lightningcss-darwin-arm64 | 1.33.0 | MPL-2.0 | transitive |
| lightningcss-darwin-x64 | 1.32.0 | MPL-2.0 | transitive |
| lightningcss-darwin-x64 | 1.33.0 | MPL-2.0 | transitive |
| lightningcss-freebsd-x64 | 1.32.0 | MPL-2.0 | transitive |
| lightningcss-freebsd-x64 | 1.33.0 | MPL-2.0 | transitive |
| lightningcss-linux-arm-gnueabihf | 1.32.0 | MPL-2.0 | transitive |
| lightningcss-linux-arm-gnueabihf | 1.33.0 | MPL-2.0 | transitive |
| lightningcss-linux-arm64-gnu | 1.32.0 | MPL-2.0 | transitive |
| lightningcss-linux-arm64-gnu | 1.33.0 | MPL-2.0 | transitive |
| lightningcss-linux-arm64-musl | 1.32.0 | MPL-2.0 | transitive |
| lightningcss-linux-arm64-musl | 1.33.0 | MPL-2.0 | transitive |
| lightningcss-linux-x64-gnu | 1.32.0 | MPL-2.0 | transitive |
| lightningcss-linux-x64-gnu | 1.33.0 | MPL-2.0 | transitive |
| lightningcss-linux-x64-musl | 1.32.0 | MPL-2.0 | transitive |
| lightningcss-linux-x64-musl | 1.33.0 | MPL-2.0 | transitive |
| lightningcss-win32-arm64-msvc | 1.32.0 | MPL-2.0 | transitive |
| lightningcss-win32-arm64-msvc | 1.33.0 | MPL-2.0 | transitive |
| lightningcss-win32-x64-msvc | 1.32.0 | MPL-2.0 | transitive |
| lightningcss-win32-x64-msvc | 1.33.0 | MPL-2.0 | transitive |
| lightningcss | 1.32.0 | MPL-2.0 | transitive |
| lightningcss | 1.33.0 | MPL-2.0 | transitive |
