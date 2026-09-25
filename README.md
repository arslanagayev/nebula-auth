<div align="center">

# Nebula Auth

**An interactive 3D login and sign-up experience: frosted-glass forms floating in front of a real-time WebGL galaxy that reacts to everything you type.**

[![CI](https://github.com/arslanagayev/nebula-auth/actions/workflows/ci.yml/badge.svg)](https://github.com/arslanagayev/nebula-auth/actions/workflows/ci.yml)
[![Deploy](https://github.com/arslanagayev/nebula-auth/actions/workflows/deploy.yml/badge.svg)](https://github.com/arslanagayev/nebula-auth/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-7b5cff.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](tsconfig.app.json)
[![three.js](https://img.shields.io/badge/three.js-r186-000000?logo=threedotjs&logoColor=white)](https://threejs.org)

![Nebula Auth: glass sign-in card in front of a glowing spiral galaxy](docs/preview.png)

### [Live demo](https://arslanagayev.github.io/nebula-auth/)

</div>

---

## Features

- **GPU-animated spiral galaxy**: up to 30,000 stars rendered with a custom GLSL `ShaderMaterial`. Differential rotation, twinkle, swirl and shockwaves all run in the vertex shader, so the CPU never touches the vertex buffer after upload.
- **Iridescent glass core**: a faceted `MeshPhysicalMaterial` gem (transmission, iridescence, dispersion, clearcoat, PMREM environment) that refracts the galaxy and floats behind the card's corner, so its colour bleeds through the frosted glass.
- **Glassmorphism card**: translucent fill, `backdrop-filter` blur and saturation, a gradient hairline border drawn with CSS masks, an inner highlight and layered shadows.
- **Tactile 3D interactions**: pointer-driven card tilt with a moving glare, a real 3D flip between _Sign in_ and _Create account_, and mouse parallax on the camera.
- **A scene that reacts to the UI**, through a typed event bus:

  | Interaction              | 3D reaction                                                  |
  | ------------------------ | ------------------------------------------------------------ |
  | Focus a field            | The galaxy spins slightly faster                             |
  | Type a new password      | The core pulses red → amber → green → cyan with its strength |
  | Submit (request pending) | A strong vortex swirls the galaxy and the core spins up      |
  | Success                  | A shockwave and a cyan-green colour burst                    |
  | Error                    | A brief red flash and a card shake                           |
  | Flip the card            | The galaxy gets a rotational kick                            |

- **Production-grade forms**: floating labels, live validation with `aria-invalid` and `aria-describedby`, show/hide password, Caps Lock warning, a 4-segment strength meter, loading states, a lockout countdown and success screens.
- **Realistic mock API**: simulated latency, a seeded demo account, registration, typed `Result` errors and a 30-second lockout after 5 failed attempts.
- **Robust by default**: CSS nebula fallback without WebGL, a static frame for reduced motion, rendering paused in background tabs, WebGL context-loss recovery and adaptive quality.

## Demo credentials

| Email             | Password      |
| ----------------- | ------------- |
| `demo@nebula.dev` | `Nebula#2026` |

Or click the **Demo** pill on the card to have them typed in for you. Accounts you create live in memory until you reload the tab. No data leaves your browser.

## Tech stack

| Area     | Choice                                                                            |
| -------- | --------------------------------------------------------------------------------- |
| Language | TypeScript 6 (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| 3D       | three.js r186, custom GLSL shaders, `UnrealBloomPass` + `OutputPass`              |
| UI       | Vanilla DOM and modern CSS (custom properties, masks, `backdrop-filter`, `inert`) |
| Build    | Vite 8 with a lazily loaded scene chunk                                           |
| Quality  | ESLint 10 + typescript-eslint (strict, type-checked), Prettier                    |
| Testing  | Vitest 5, happy-dom, V8 coverage                                                  |
| Fonts    | Inter and Space Grotesk variable fonts, self-hosted via Fontsource                |
| CI/CD    | GitHub Actions: CI on every push and PR, automatic GitHub Pages deployment        |

No UI framework on purpose: the project shows what the platform can do with well-structured TypeScript and CSS.

## Getting started

Requires **Node.js 22.13+** (22 LTS or 24 LTS; the repository pins 24 in `.nvmrc`, and CI tests both).

```bash
git clone https://github.com/arslanagayev/nebula-auth.git
cd nebula-auth
npm ci
npm run dev
```

Open the printed URL (usually <http://localhost:5173>).

To deploy your own copy: push to GitHub, set **Settings → Pages → Source** to **GitHub Actions**, then re-run the Deploy workflow (**Actions → Deploy → Run workflow**). The first run fails until Pages is enabled, which leaves the Deploy badge red until it is re-run. The workflow lints and tests before it builds, and reads the correct base path from the Pages configuration, so a renamed fork or a custom domain works without changes.

## Scripts

| Script                  | Description                                             |
| ----------------------- | ------------------------------------------------------- |
| `npm run dev`           | Start the Vite dev server with hot module replacement   |
| `npm run build`         | Type-check and create a production build in `dist/`     |
| `npm run preview`       | Serve the production build locally                      |
| `npm run lint`          | Lint with ESLint and type-aware typescript-eslint rules |
| `npm run format`        | Format the codebase with Prettier                       |
| `npm run format:check`  | Verify formatting (used in CI)                          |
| `npm run typecheck`     | Run the TypeScript compiler in build mode               |
| `npm test`              | Run the test suite once                                 |
| `npm run test:watch`    | Run tests in watch mode                                 |
| `npm run test:coverage` | Run tests with V8 coverage and enforce thresholds       |

## Project structure

```text
nebula-auth/
├── index.html                  # Semantic markup for both card faces
├── public/favicon.svg
├── src/
│   ├── main.ts                 # Bootstrap: UI first, then lazy-load the 3D scene
│   ├── core/
│   │   ├── events.ts           # Typed publish/subscribe EventBus
│   │   └── appEvents.ts        # The UI ↔ scene event contract
│   ├── lib/                    # Pure, fully tested logic (no DOM, no WebGL)
│   │   ├── validation.ts       # Email, name, password and confirmation rules
│   │   ├── passwordStrength.ts # 0–4 strength score with actionable hints
│   │   ├── authService.ts      # Mock API: latency, demo account, lockout
│   │   ├── quality.ts          # Device-based rendering budget
│   │   ├── frameBudget.ts      # Adaptive quality monitor
│   │   └── math.ts, random.ts, result.ts, commonPasswords.ts
│   ├── scene/                  # three.js, loaded as a separate chunk
│   │   ├── NebulaScene.ts      # Renderer, camera, loop, events, disposal
│   │   ├── galaxy.ts           # Galaxy points + ShaderMaterial
│   │   ├── galaxyData.ts       # Seeded star distribution
│   │   ├── core.ts             # Iridescent glass core
│   │   ├── postprocessing.ts   # Bloom + output passes
│   │   ├── starfield.ts, textures.ts, palette.ts, support.ts, loadScene.ts
│   │   └── shaders/            # galaxy.vert.glsl, galaxy.frag.glsl
│   ├── ui/
│   │   ├── form.ts             # Generic form controller + password helpers
│   │   ├── authForms.ts        # Sign-in / register flows
│   │   ├── flip.ts             # 3D card flip with focus management
│   │   ├── tilt.ts             # Pointer tilt and glare
│   │   ├── toast.ts            # aria-live notifications
│   │   └── layout.ts           # Publishes the card position to the scene
│   └── styles/                 # Tokens, base, layout, card, forms, buttons, motion
├── tests/                      # Unit tests and DOM tests against index.html
├── docs/ARCHITECTURE.md
└── .github/workflows/          # ci.yml, deploy.yml
```

## Architecture

The UI and the WebGL scene never import each other. The UI publishes intent on a strongly typed event bus (`field:focus`, `password:strength`, `auth:pending`, `auth:success`, `auth:error`, `view:flip`, …) and the scene turns those events into animation targets that are eased every frame. This keeps the 150 kB (gzipped) three.js chunk off the critical path, lets every UI module be tested without a GPU, and means the page works exactly the same when WebGL is unavailable.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for module and event-flow diagrams, the render loop, the shader maths and the performance and accessibility decisions.

## Accessibility and performance

**Accessibility**

- Semantic `<form>`, `<label>` and heading structure; every control works with the keyboard.
- Validation errors are linked with `aria-describedby`, flagged with `aria-invalid` and only appear after a field is left, never mid-typing. Authentication errors use `role="alert"`, toasts use a polite live region.
- The hidden card face is `inert`, so it is removed from the tab order and the accessibility tree. Focus moves into the new face after each flip.
- Visible focus indicators everywhere, and text colours chosen to meet WCAG 2.2 AA contrast on the glass surface.
- `prefers-reduced-motion`: no tilt, shake, shimmer or drift, instant flips and a static 3D frame.

**Performance**

- The form is interactive before three.js is even requested: the scene is a separate chunk loaded after the first paint.
- All star motion happens in the vertex shader; there are no per-frame allocations in the render loop.
- Device pixel ratio is capped (2 on desktop, 1.5 on mobile, 1 on low-end devices), particle counts scale by device tier and bloom only runs on capable desktops.
- A frame-time monitor drops bloom, then resolution, if the device cannot keep up.
- Rendering stops while the tab is hidden, resizes are debounced and every GPU resource is disposed on teardown.

## Testing

```bash
npm test               # 170+ unit and DOM tests
npm run test:coverage  # enforces ≥ 90% line coverage for src/lib and src/core
```

- **Pure logic** (`src/lib`, `src/core`) is covered at 100% of lines: validators, the strength estimator, the auth service with fake timers (latency, lockout, unlock), the event bus, quality profiles and maths helpers.
- **Markup checks** parse the shipped `index.html` and fail on dangling ARIA references, duplicate ids, unlabelled controls, untyped buttons or SVGs exposed to screen readers.
- **DOM behaviour** is tested with happy-dom against the real `index.html` markup: live validation, ARIA attributes, loading and success states, the lockout countdown, password toggles, the Caps Lock hint, the strength meter, flips with focus management, tilt and toasts.
- The WebGL layer is excluded from coverage because it needs a real GPU; its pure parts (star generation, quality selection) are tested separately.

## Roadmap

- [ ] Playwright end-to-end tests with visual regression snapshots of the reduced-motion frame
- [ ] A real `AuthService` adapter (OIDC / REST) with `httpOnly` cookie sessions
- [ ] Passkey (WebAuthn) sign-in as the primary option
- [ ] Breached-password check using the Have I Been Pwned k-anonymity API
- [ ] A WebGPU renderer path with TSL shaders, falling back to WebGL 2
- [ ] Localised validation messages and right-to-left layout support

## Author

**Arslan Agayev**, computer science student building interactive web experiences.

- GitHub: [@arslanagayev](https://github.com/arslanagayev)
- Instagram: [@arslanagayev.dev](https://www.instagram.com/arslanagayev.dev/)

## License

[MIT](LICENSE) © 2026 Arslan Agayev
