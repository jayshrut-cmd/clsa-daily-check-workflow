# clsa-daily-check — autonomous daily research workflow for GitHub Copilot

A 6-stage agentic workflow for GitHub Copilot CLI that runs a daily
research check on **CLSA.TO** (a Canadian covered-call split-corp ETF):
price vs NAV, a sweep of its top 12 holdings, Brompton announcements,
independent verification, a human review checkpoint, and a run log.

Built and smoke-tested on the **free tier** of GitHub Copilot (CLI 1.0.95)
— dynamic workflows are included, no paid plan needed.

## The 6 stages

1. **CLSA price vs NAV** — close, day change, volume, latest NAV, premium/discount
2. **Top-holdings sweep** — LBS, SBC, DFN, FTN, FFN, LCS, ENS, GDV, PWI, DF,
   IS, DGS: price moves, distribution cuts/suspensions, NAV-threshold flags
   (parallel subagents)
3. **Brompton announcements** — new distributions, press releases
4. **Verification** — an independent second pass over the numbers before
   anything is reported
5. **Review checkpoint** — pauses for human review: resume to approve,
   cancel to reject
6. **Log** — the approved check is appended to the run log

## Install

Copy this file as `extension.mjs` into a Copilot extensions folder:

```
~/.copilot/extensions/clsa-daily-check/extension.mjs
```

Then run it:

```bash
copilot workflow run clsa-daily-check
```

(Non-interactive runs need `GITHUB_COPILOT_PROMPT_MODE_EXTENSIONS=true`.)

## Requirements

- GitHub Copilot CLI 1.0.95+ — `npm install -g @github/copilot`
  (install with `--prefix ~/.npm-global` and add `~/.npm-global/bin` to
  `PATH` so it survives machine rebuilds)
- Signed in via `gh auth login`

## Honest notes

- **Research only.** The workflow never emits buy/sell instructions — by
  design, in the spec.
- **Stage 1 refuses to fabricate.** If web access is unavailable, the stage
  errors instead of inventing numbers (verified in dry run).
- **Each run costs AI credits** (~0.3 credits for a short run on the free tier).
- **No built-in scheduling.** Dynamic workflows don't schedule themselves —
  pair with cron / Task Scheduler for the daily slot (this one targets
  ~4:08 PM ET on TSX weekdays).

## License

MIT — see [LICENSE](LICENSE).
