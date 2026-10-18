import { defineWorkflow, joinSession } from "@github/copilot-sdk/extension";

const holdings = ["LBS", "SBC", "DFN", "FTN", "FFN", "LCS", "ENS", "GDV", "PWI", "DF", "IS", "DGS"];

const clsaDailyCheck = defineWorkflow({
    meta: {
        name: "clsa-daily-check",
        description:
            "Daily CLSA.TO research check. args: {}. Intended for an external scheduler on TSX weekdays around 4:08 PM America/Toronto; dynamic workflows do not schedule themselves. Stage 5 pauses for human review: resume to approve, or cancel to reject. Reports research only, never buy/sell instructions.",
        phases: [
            { title: "Stage 1 — CLSA price vs NAV" },
            { title: "Stage 2 — Top holdings sweep" },
            { title: "Stage 3 — Brompton announcements" },
            { title: "Stage 4 — Verification" },
            { title: "Stage 5 — Review checkpoint" },
            { title: "Stage 6 — Log approved check" },
        ],
        argsSchema: { type: "object" },
    },
    run: async (ctx) => {
        const stage1Schema = {
            type: "object",
            required: ["asOf", "close", "dayChange", "dayChangePct", "volume", "nav", "navAsOf", "sources"],
            properties: {
                asOf: { type: "string" },
                close: { type: "number" },
                dayChange: { type: "number" },
                dayChangePct: { type: "number" },
                volume: { type: "number" },
                nav: { type: "number" },
                navAsOf: { type: "string" },
                sources: {
                    type: "array",
                    items: {
                        type: "object",
                        required: ["name", "url", "kind"],
                        properties: {
                            name: { type: "string" },
                            url: { type: "string" },
                            kind: { type: "string", enum: ["official", "market"] },
                        },
                    },
                },
            },
        };
        const holdingSchema = {
            type: "object",
            required: ["holding", "dataAvailable", "dayChangePct", "flags", "sources", "notes"],
            properties: {
                holding: { type: "string" },
                dataAvailable: { type: "boolean" },
                dayChangePct: { type: ["number", "null"] },
                flags: {
                    type: "array",
                    items: {
                        type: "object",
                        required: ["category", "detail", "source"],
                        properties: {
                            category: {
                                type: "string",
                                enum: ["price_move", "distribution_cut", "distribution_suspension", "nav_threshold", "other"],
                            },
                            detail: { type: "string" },
                            source: { type: "string" },
                        },
                    },
                },
                sources: { type: "array", items: { type: "string" } },
                notes: { type: "string" },
            },
        };
        const newsSchema = {
            type: "object",
            required: ["checkedAt", "announcements"],
            properties: {
                checkedAt: { type: "string" },
                announcements: {
                    type: "array",
                    items: {
                        type: "object",
                        required: ["date", "category", "title", "url", "summary"],
                        properties: {
                            date: { type: "string" },
                            category: {
                                type: "string",
                                enum: ["distribution_declaration", "distribution_change", "holdings_disclosure", "MRFP", "other"],
                            },
                            title: { type: "string" },
                            url: { type: "string" },
                            summary: { type: "string" },
                        },
                    },
                },
            },
        };
        const verificationSchema = {
            type: "object",
            required: ["verified", "arithmeticCheck", "discrepancies", "confirmedFlags", "sources"],
            properties: {
                verified: { type: "boolean" },
                arithmeticCheck: { type: "string" },
                discrepancies: { type: "array", items: { type: "string" } },
                confirmedFlags: { type: "array", items: { type: "string" } },
                sources: { type: "array", items: { type: "string" } },
            },
        };
        const requireResult = (value, label) => {
            if (value === null || value === undefined) {
                throw new Error(`${label} returned no result; the daily check cannot be reported.`);
            }
            return value;
        };
        const pct = (value) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

        ctx.phase("Stage 1 — CLSA price vs NAV");
        const stage1 = requireResult(
            await ctx.agent(
                "Research Brompton Lifeco Split Corp. (TSX: CLSA) for its latest completed TSX trading session. Use Brompton's official CLSA product page for NAV and one independent market-data source for the latest close, absolute day change, percent day change, and volume. Return dates/as-of dates, numeric values, and direct source URLs. Do not infer missing values.",
                { label: "clsa-price-nav", schema: stage1Schema },
            ),
            "CLSA price/NAV research",
        );
        if (!stage1.sources.some((source) => source.kind === "official") || !stage1.sources.some((source) => source.kind === "market")) {
            throw new Error("Stage 1 did not provide both Brompton official and independent market sources; no report was produced.");
        }
        if (
            !(stage1.nav > 0) ||
            !(stage1.close > 0) ||
            !(stage1.volume >= 0) ||
            !Number.isFinite(stage1.dayChange) ||
            !Number.isFinite(stage1.dayChangePct) ||
            !/^\d{4}-\d{2}-\d{2}/.test(stage1.asOf)
        ) {
            throw new Error("Stage 1 returned invalid or unusable price/NAV data; no report was produced.");
        }
        const navGapPct = ((stage1.close - stage1.nav) / stage1.nav) * 100;

        ctx.phase("Stage 2 — Top holdings sweep");
        const holdingResults = await ctx.parallel(
            holdings.map((holding) => () =>
                ctx.agent(
                    `Check ${holding} Class A for its latest completed TSX-session move and relevant news. Flag a single-day move only when its absolute value is greater than 3%. Also check for Class A distribution cuts/suspensions and NAV threshold breaches. Use reliable market/news sources and provide URLs; do not treat rumors as facts. Set dataAvailable true only if you can verify the latest session move and complete the checks; otherwise set false and explain in notes. Return dayChangePct as a number when available (otherwise null), and an empty flags array if nothing material was found. Put each finding in flags with category, detail, and source URL.`,
                    { label: `holding:${holding}`, schema: holdingSchema },
                ),
            ),
        );
        const checkedHoldings = holdingResults.map((result, index) => {
            const checked = requireResult(result, `Holding ${holdings[index]} scan`);
            if (checked.holding !== holdings[index]) {
                throw new Error(`Holding scan mismatch: expected ${holdings[index]}, received ${checked.holding}.`);
            }
            if (!checked.dataAvailable || !Number.isFinite(checked.dayChangePct) || checked.sources.length === 0) {
                throw new Error(`Holding ${holdings[index]} could not be fully checked; no daily alert was produced. ${checked.notes}`);
            }
            return checked;
        });

        ctx.phase("Stage 3 — Brompton announcements");
        const news = requireResult(
            await ctx.agent(
                "Check Brompton Funds' official website, news, and filings for new announcements relevant to CLSA and its portfolio: distribution declarations/changes, underlying holdings disclosure updates, and MRFP updates. Prefer official primary sources, include direct URLs and dates, and return an empty announcements array only after checking the official sources. Do not give investment advice.",
                { label: "brompton-announcements", schema: newsSchema },
            ),
            "Brompton announcements search",
        );

        ctx.phase("Stage 4 — Verification");
        const verification = requireResult(
            await ctx.agent(
                `Independently cross-check the following Stage 1-3 data against source pages and verify the arithmetic. Treat supplied URLs only as leads; inspect sources independently. Stage 1: ${JSON.stringify({ ...stage1, calculatedNavGapPct: navGapPct })}. Holding checks: ${JSON.stringify(checkedHoldings)}. Brompton announcements: ${JSON.stringify(news)}. Recalculate premium/discount as (close - NAV) / NAV * 100 and compare with ${navGapPct.toFixed(4)}%. Verify close, day change/percent, volume, and NAV dates/values, and cross-check the reported day-change percentage for every holding against reliable market data. For EVERY holding flagged price_move, confirm the move with a second source; independently confirm material distribution/NAV flags and Brompton announcement items. Set verified false and list any unresolved discrepancy, missing corroboration, or material mismatch. In confirmedFlags, identify each corroborated holding flag as TICKER:category. Include URLs for sources used.`,
                { label: "independent-verification", schema: verificationSchema },
            ),
            "Independent verification",
        );
        if (!verification.verified || verification.discrepancies.length > 0) {
            throw new Error(
                `Stage 4 verification failed; nothing was presented as a daily alert. ${
                    verification.discrepancies.join("; ") || "Verifier did not confirm the data."
                }`,
            );
        }
        const confirmedFlags = new Set(verification.confirmedFlags);
        const flaggedHoldings = checkedHoldings.flatMap((item) =>
            item.flags.map((flag) => ({ holding: item.holding, ...flag })),
        );
        for (const flag of flaggedHoldings) {
            const key = `${flag.holding}:${flag.category}`;
            if (!confirmedFlags.has(key)) {
                throw new Error(`Stage 4 did not independently confirm ${key}; nothing was presented as a daily alert.`);
            }
        }

        const topFive = new Set(holdings.slice(0, 5));
        const topFiveDistributionCut = flaggedHoldings.some(
            (flag) =>
                topFive.has(flag.holding) &&
                ["distribution_cut", "distribution_suspension"].includes(flag.category),
        );
        const clsaDrop = stage1.dayChangePct < -3;
        const extremeNavGap = Math.abs(navGapPct) > 5;
        const material =
            clsaDrop || extremeNavGap || topFiveDistributionCut || flaggedHoldings.length > 0 || news.announcements.length > 0;
        const flags = [];
        if (clsaDrop) flags.push(`CLSA fell ${pct(stage1.dayChangePct)}`);
        if (extremeNavGap) flags.push(`CLSA at ${pct(navGapPct)} to NAV`);
        if (topFiveDistributionCut) flags.push("top-five Class A distribution cut/suspension");
        for (const flag of flaggedHoldings) flags.push(`${flag.holding} ${flag.category}: ${flag.detail}`);
        for (const item of news.announcements) flags.push(`${item.category}: ${item.title} (${item.date})`);

        const distributionStatus =
            news.announcements
                .filter((item) => ["distribution_declaration", "distribution_change"].includes(item.category))
                .map((item) => `${item.title} (${item.date})`)
                .join("; ") || "no new Brompton distribution declaration/change found";
        const watch = flags.length ? flags.join("; ") : "none identified";
        let draft;
        if (!material) {
            draft = `CLSA.TO: close $${stage1.close.toFixed(2)} (${pct(stage1.dayChangePct)}); volume ${Math.round(stage1.volume).toLocaleString("en-CA")} | NAV $${stage1.nav.toFixed(2)} (${pct(navGapPct)} ${navGapPct >= 0 ? "premium" : "discount"}).\nDistributions: ${distributionStatus}. Holdings/news watch: ${watch}.`;
        } else {
            const priorityFlags = flags.filter(
                (flag) => flag.startsWith("CLSA ") || flag.startsWith("top-five"),
            );
            const lead = priorityFlags.length ? `FLAG — ${priorityFlags.join("; ")}. ` : "WATCH — material update. ";
            draft = `${lead}CLSA.TO close $${stage1.close.toFixed(2)} (${pct(stage1.dayChangePct)}); NAV $${stage1.nav.toFixed(2)} (${pct(navGapPct)} ${navGapPct >= 0 ? "premium" : "discount"}), volume ${Math.round(stage1.volume).toLocaleString("en-CA")}.\nDistributions: ${distributionStatus}. Holdings/news: ${watch}.`;
        }

        ctx.phase("Stage 5 — Review checkpoint");
        ctx.log(`DRAFT FOR HUMAN REVIEW (not yet today's approved alert):\n${draft}`);
        await ctx.pause("clsa-daily-check-review-v1");

        ctx.phase("Stage 6 — Log approved check");
        const logDate = stage1.asOf.slice(0, 10);
        const logEntry = `${logDate} | CLSA close $${stage1.close.toFixed(2)} | NAV gap ${pct(navGapPct)} | flags: ${
            flags.length ? flags.join("; ").replace(/[\r\n]+/g, " ") : "none"
        }`;
        const durableLogEntry = await ctx.step("approved-daily-log-v1", () => logEntry);
        ctx.log(`APPROVED DAILY CHECK LOG: ${durableLogEntry}`);
        return { status: "approved_and_logged", draft, logEntry: durableLogEntry, verified: true };
    },
});

export const session = await joinSession({ workflows: [clsaDailyCheck] });
export { clsaDailyCheck };
