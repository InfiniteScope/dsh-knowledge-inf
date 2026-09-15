# Installation Recovery Documentation Design

## Context

Issue #22 reports `ERR_PNPM_WORKSPACE_MANIFEST_WRITER_PARSE` while the DSH
plugin hub installs `dsh-knowledge`. The error occurs while pnpm parses the
target DSH profile's `pnpm-workspace.yaml`, before it resolves or downloads the
plugin. The plugin cannot repair that user-owned profile file automatically.

The existing README build-permission snippet is also incomplete for a Git
install: it omits `esbuild`, and its `tesseract.js` setting differs from the
verified packed-install configuration.

## Scope

Update `README.md` and `README.en.md` only. Do not change runtime code,
installation behavior, the package version, or any user's profile files.

## Documentation Changes

1. Replace the build-permission snippet with the verified Git-install set:
   `esbuild`, `onnxruntime-node`, `protobufjs`, and `sharp` enabled;
   `tesseract.js` disabled.
2. State that users must merge these keys into an existing `allowBuilds`
   mapping, rather than adding a duplicate YAML key.
3. Add a concise recovery section for
   `ERR_PNPM_WORKSPACE_MANIFEST_WRITER_PARSE`:
   - identify the profile-local `pnpm-workspace.yaml` as the failing file;
   - tell users to back it up and fix the reported YAML line;
   - provide a known-good minimal profile file only for profiles without other
     intentional pnpm configuration;
   - direct users to rerun the same `dsh plugin` command afterward.
4. Clarify that an `ERR_PNPM_IGNORED_BUILDS` after the YAML repair is a
   distinct build-approval error; users should use the exact package key pnpm
   reports rather than broadly allowing scripts.

## Safety and Verification

The recovery flow never instructs users to overwrite an unknown profile file
without a backup. Verify the two README files remain aligned, check whitespace
with `git diff --check`, and ensure the published package still includes both
README files via the existing package verifier.
