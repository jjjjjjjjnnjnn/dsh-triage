<!-- facts: docs/copy/facts/2026-11-05-batch2.md -->
# #12209 · plugin manager offers unpublished version as upgrade
<!-- channel: https://github.com/deepseek-ai/deepseek-harness/discussions/12209 · English · ready-to-post -->
<!-- paste:start -->
One data point on the update prompt: the prompt offering `0.12.3` disappeared because the author unpublished that version from npm, not because the plugin manager resolved the semver-versus-publish-order comparison.

Registry probe readings against target runtime `0.2.2-rc.1`:
- `dsh-win-pwsh7@0.2.6` -> `admitted` (1 item: `engines.dsh >=0.2.1-rc.3 <0.3.0-0`)
- `dsh-win-pwsh7@0.12.3` -> `unreadable` (`version 0.12.3 is not on the registry`)
- Registry dist-tags: `latest = 0.2.6`

The installed `0.2.6` build is `latest` and satisfies declaration-layer admission under `0.2.2-rc.1`. The update notification vanished only because `0.12.3` no longer exists on the registry. Relying on authors to unpublish abandoned release lines is not an option available to every ecosystem maintainer, and the manager comparison still treats higher semver numbers as upgrades regardless of release sequence.

What you can do:
- Keep `dsh-win-pwsh7@0.2.6` installed; its declaration matches `0.2.2-rc.1`.
- If a similar prompt reappears for other plugins, verify whether the offered version is an unmaintained legacy line before upgrading.

I maintain dsh-triage, the read-only tool that produced these numbers.

This reads published manifests from npm, not your machine. Declaration-layer admission does not prove runtime health.

Recompute artifact: https://github.com/jjjjjjjjnnjnn/dsh-triage/blob/main/data/results/remedy-probe-2026-11-05T08-37-26-770Z.json (sha256 `596acd45466e41cef22f4e582c859d88dbadad8acc552e43c99112d45fc83326`)
<!-- paste:end -->
