# e-Akta Viewer agent guide

## Product and architecture

- Build only the macOS React Native application. Application logic is React, React Native, and strict TypeScript.
- The supported dossier profile is Microsec e-dossier 1.2 with the `https://www.microsec.hu/ds/e-szigno30#` namespace.
- `src/verifier/` owns XML parsing, extraction, XMLDSIG/XAdES, RFC 3161, certificate-chain, revocation, and trusted-list validation.
- `src/components/VerifierHost.tsx` is the protocol-v1 capability RPC boundary around the isolated verifier WebView.
- `src/native/specs/NativeES3MacBridge.ts` is the generated TurboModule contract. Native Objective-C++ implements AppKit and constrained I/O/security capabilities only. It must not parse dossier XML.
- The New Architecture, Fabric, and Hermes are mandatory. Never add a legacy bridge fallback.
- Do not add Android, iOS, Java, JVM, Gradle, or Java helper code.

## Commands

- `make bootstrap`: install npm/Ruby/CocoaPods dependencies and assert the New Architecture.
- `make start`: generate the verifier and run Metro.
- `make run`: build and launch the macOS development app.
- `make verifier`: reproducibly generate the isolated verifier bundle.
- `make lint`, `make format-check`, `make typecheck`, `make test`: focused checks.
- `make check`: source policy, architecture, reproducibility, lint, formatting, types, and tests.
- `make trust-update`: verify and update the tracked EU LOTL/HU TSL snapshot.
- `make app`: universal Release build, ad-hoc signing, entitlement verification, and Mach-O checks.
- `make package VERSION=x.y.z`: metadata-preserving unsigned release ZIP.
- `make smoke`: optional local aggregate smoke test using only `ES3_TEST_FIXTURE`.
- `make clean`: remove generated local build output.

## Code and tests

- Keep files focused and preferably below 500 lines. Split by durable responsibility, not arbitrary size.
- Use exported domain interfaces from `src/domain/types.ts`. Public status is exactly `valid | invalid | indeterminate`.
- Preserve bounded streaming and one-chunk backpressure across every native/WebView resource.
- Test observable behavior, boundary values, status reduction, cancellation, and hostile XML/archive/crypto inputs. Synthetic fixtures must be generated at runtime. Public fixed vectors require source and license comments.
- English is required for identifiers, comments, logs, test names, docs, changelog, and releases. Hungarian belongs only in Hungarian catalogs/resources.
- Keep `src/i18n/en.ts` and `src/i18n/hu.ts` key-identical.

## Privacy and security

- Never commit or log `.es3`/`.et3` files, names, paths, metadata, hashes, signature values, signer data, or extracted content.
- Never print the value of `ES3_TEST_FIXTURE`. Smoke output contains aggregate counts only.
- Dossier content remains on-device. Only public LOTL/TSL/AIA/OCSP/CRL evidence may use the network.
- All evidence traffic goes through the native broker. Preserve DNS rebinding/redirect/private-address defenses, response limits, cancellation, and opaque capability staging.
- Trust snapshots and cache replacements are accepted only after signature, pin, hash, size, and NextUpdate validation.
- Export only native-owned temporary output capabilities. Ignore archive paths and keep collision-safe destination naming.

## Dependencies and releases

- Use Node 24 and npm. `package-lock.json` is canonical; automation uses `npm ci`.
- Before updating a dependency, verify its engines and peer range against React Native 0.81.6, React Native macOS 0.81.9, React 19.2.8, and TypeScript 7.0.2.
- Conventional Commits are mandatory: `feat(viewer): add preview`, `fix(verifier): reject duplicate IDs`, `docs: explain privacy`, `test(crypto): add timestamp vector`, `build: update toolchain`, `ci: package universal app`, `chore: refresh trust snapshot`.
- Use `!` or a `BREAKING CHANGE:` footer for breaking changes.
- Release Please owns version and changelog updates. Release assets remain named `unsigned` because ad-hoc signing supplies no publisher identity or notarization.
- Never commit directly to `main`. Create a focused branch, push it, and open a pull request.
- Require the pull request checks to pass before merging. Keep unrelated changes in separate pull requests.
