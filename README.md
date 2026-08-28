# e-Akta Viewer

e-Akta Viewer is a bilingual React Native macOS application for opening, previewing, validating, and exporting Microsec e-dossier 1.2 (`.es3`) files entirely on-device.

## Capabilities

- Open from Finder, **File → Open Dossier…**, or drag-and-drop.
- Extract primary documents and documents attached to signature comments with bounded streaming.
- Preview sanitized HTML, escaped text/XML/JSON, Quick Look content, or a deterministic hex fallback.
- Validate XMLDSIG/XAdES signatures, reference scope, signing certificates, RFC 3161 timestamps, historical chains, and revocation evidence.
- Verify the EU LOTL and Hungarian TSL from OJEU-pinned bootstrap identities.
- Export one document or all extractable components through native collision-safe save panels.
- Switch between system language, English, and Hungarian.

Dossier bytes, names, metadata, signatures, and previews remain on the Mac. Only public trusted-list, certificate, OCSP, and CRL evidence may use the network, through a constrained native broker.

## Requirements

- macOS 14 or later
- Xcode 26
- Node 24
- npm
- Ruby/Bundler and CocoaPods

## Development

```sh
make bootstrap
make check
make run
```

Useful focused targets include `make verifier`, `make lint`, `make format-check`, `make typecheck`, `make test`, and `make trust-update`.

## Packaging

```sh
make package VERSION=0.1.0
```

The output is `dist/e-Akta-Viewer-0.1.0-macos-universal-unsigned.zip`. The enclosed app is universal and ad-hoc signed with sandbox, user-selected read/write, and network-client entitlements. It is not Developer ID signed or notarized.

## Privacy and fixture policy

Never commit or log `.es3`/`.et3` files or their paths, names, metadata, hashes, signer data, signature values, or extracted content. Optional local smoke verification accepts a fixture only through the `ES3_TEST_FIXTURE` environment variable and reports aggregate state only.

## Independence notice

e-Akta Viewer is an independent application. It is not affiliated with, endorsed by, or supported by Microsec Ltd. or the e‑Szignó service. Validation results are informational and do not replace an official qualified validation report.
