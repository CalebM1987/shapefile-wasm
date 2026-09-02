# Security policy

## Reporting a vulnerability

Please report security issues privately through
[GitHub Security Advisories](https://github.com/CalebM1987/shapefile-wasm/security/advisories/new)
rather than opening a public issue.

Include what you can: a description, the affected version, and a reproduction if
you have one. You should get an acknowledgement within a few days.

## What this package does with your data

Nothing leaves the machine it runs on. Conversion happens entirely in
WebAssembly, in memory. There is no telemetry and no analytics.

The one exception is `fetchProjection`, which requests a coordinate system
definition from [epsg.io](https://epsg.io). It is opt-in — nothing calls it for
you — and it sends only the EPSG code you asked for. The bundled projection table
is the default precisely so that an export never depends on a third-party
service. Point `baseUrl` at your own mirror if outbound requests are not
acceptable in your environment.

## Supply chain

**One runtime dependency.** The published package depends only on
[`fflate`](https://github.com/101arrowz/fflate) for zip handling. Everything else
in `devDependencies` is build and test tooling that never reaches consumers.

**Published from CI with provenance.** Releases are built and published by a
GitHub Actions workflow using npm Trusted Publishing, so no long-lived npm token
exists to be phished or leaked. Each release carries a
[provenance attestation](https://docs.npmjs.com/generating-provenance-statements)
linking the tarball to the commit and workflow that produced it. Verify it with:

```bash
npm audit signatures
```

**Actions pinned to commit SHAs.** Every GitHub Action used in CI is pinned to a
full commit SHA rather than a moving tag, and updated via Dependabot.

**Least privilege.** Each workflow declares the narrowest `permissions` it needs.
Only the publish and Pages workflows can mint an OIDC token, and neither runs on
pull requests.

**A restricted publish surface.** `package.json` uses a `files` allowlist, so
only `dist/`, the `.wasm` and its bindings, the README and the LICENSE are
published. Inspect exactly what a release contains with `npm pack --dry-run`.

## Verifying a release

```bash
# The tarball's provenance and registry signatures.
npm audit signatures

# What is actually inside it.
npm pack @crmackey/shapefile-wasm
tar -tzf crmackey-shapefile-wasm-*.tgz
```

Anything unexpected in that listing is worth reporting.

## Scope

The WebAssembly module parses untrusted input — a `.shp` or `.dbf` from an
unknown source is attacker-controlled data. WebAssembly is memory-safe and
sandboxed, and this crate declares `#![forbid(unsafe_code)]`, so a malformed file
should produce an error rather than memory corruption. A crafted file that
causes a panic, a hang, or unbounded memory growth is in scope, and worth
reporting.
