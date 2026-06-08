import { useState, useMemo } from "react";

/* ============================================================================
   THE IDEA (plain): an AI moves a company's core records to a new system, then
   writes its own test to prove the move worked — it grades its own homework.
   This is an independent second check, run by something that didn't do the move.

   This harness is built to be ABLE TO BE WRONG:
     - some faults the AI's own self-check DOES catch (so 0% isn't rigged)
     - one fault NEITHER check catches (so the gate's score is honest, with a
       stated blind spot and the fix named)
   ========================================================================== */

const MATERIALITY = 2500; // $ — a "big enough to matter" line that scales with company size
const TRIVIAL_FLOOR = 10; // $ — below this, a difference is too small to care about

const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;
const money = (n) =>
  typeof n === "number" ? "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : n;

const controlTotals = (lines) => {
  let debit = 0;
  for (const l of lines) debit += l.debit;
  return { debit: round2(debit) };
};

/* ---- the AI's own self-check: looks at each record on its own ---- */
function runSelfTest(result) {
  const lines = result.targetLines;
  const checks = [
    { name: "Every entry has all its fields", pass: lines.every((l) => l.docId && l.account && l.bpRef && typeof l.debit === "number") },
    { name: "Amounts are real numbers", pass: lines.every((l) => Number.isFinite(l.debit) && Number.isFinite(l.credit)) },
    { name: "Account codes are well-formed", pass: lines.every((l) => /^\d{6}$/.test(l.account)) },
    { name: "Every entry has a non-zero amount", pass: lines.every((l) => l.debit > 0 || l.credit > 0) },
  ];
  return {
    pass: checks.every((c) => c.pass),
    rowsInspected: lines.length,
    checks,
    blindSpot: "It looks at each record on its own. It never compares the finished migration back against what was there to start with.",
  };
}

/* ---- the independent check: compares the finished migration back against the source ---- */
function runIndependentGate(source, result) {
  const src = controlTotals(source.lines);
  const tgt = controlTotals(result.targetLines);

  const deltaAbs = round2(Math.abs(src.debit - tgt.debit));
  const deltaPct = src.debit === 0 ? 0 : round4((deltaAbs / src.debit) * 100);
  let finSev = "ok";
  if (deltaAbs > MATERIALITY) finSev = "hard";
  else if (deltaAbs > TRIVIAL_FLOOR) finSev = "soft";
  const financial = {
    q: "Does the money still add up?",
    tech: "financial reconciliation",
    severity: finSev,
    source: money(src.debit),
    target: money(tgt.debit),
    message:
      finSev === "ok"
        ? deltaAbs === 0
          ? "The migrated total matches the source total, to the cent."
          : `Off by ${money(deltaAbs)}, too small to worry about.`
        : finSev === "soft"
        ? `Off by ${money(deltaAbs)} (${deltaPct}%). Small but not exact, so it is worth a human glance.`
        : `Off by ${money(deltaAbs)} (${deltaPct}%). That is real money missing.`,
  };

  const masterShort = source.masters.length - result.targetBPs.length;
  const lineShort = source.lines.length - result.targetLines.length;
  const completeness = {
    q: "Did every record make it?",
    tech: "record completeness",
    severity: masterShort > 0 || lineShort > 0 ? "hard" : "ok",
    source: `${source.masters.length} owners / ${source.lines.length} entries`,
    target: `${result.targetBPs.length} owners / ${result.targetLines.length} entries`,
    message: masterShort > 0 || lineShort > 0 ? `${masterShort} owner(s) and ${lineShort} entry(s) never arrived.` : "Everything that went in came out.",
  };

  const ids = new Set(result.targetBPs.map((b) => b.id));
  const orphans = result.targetLines.filter((l) => !ids.has(l.bpRef));
  const integrity = {
    q: "Does every entry point to a real owner?",
    tech: "referential integrity",
    severity: orphans.length > 0 ? "hard" : "ok",
    source: `${ids.size} valid owners`,
    target: `${orphans.length} entry(s) pointing nowhere`,
    message: orphans.length > 0 ? `${orphans.length} entry(s) point to an owner that no longer exists.` : "Every entry points to a real owner.",
  };

  const violations = result.accountMap.filter((m) => m.sourceCategory !== m.targetCategory);
  const semantic = {
    q: "Do the numbers still mean the same thing?",
    tech: "business-logic preservation",
    severity: violations.length > 0 ? "soft" : "ok",
    source: "what each amount represents",
    target: violations.length ? `${violations.length} changed meaning` : "unchanged",
    message: violations.length
      ? "An amount the company OWES is now filed as money it SPENT. That might be a mistake or an intended change, so a person needs to confirm."
      : "Every amount still means what it meant before.",
  };

  return { dimensions: [financial, completeness, integrity, semantic] };
}

function decideVerdict(gate) {
  const hard = gate.dimensions.filter((d) => d.severity === "hard");
  const soft = gate.dimensions.filter((d) => d.severity === "soft");
  if (hard.length) return { verdict: "BLOCK", label: "STOP, don't switch over", rationale: "Something is clearly broken." };
  if (soft.length) return { verdict: "REVIEW", label: "A person should check", rationale: "Nothing's broken, but something needs a human to sign off." };
  return { verdict: "APPROVE", label: "Safe to switch over", rationale: "Everything checks out against the original." };
}

/* ============================================================================
   the data + the five things that can happen in a migration
   ========================================================================== */
const ACCOUNTS = { "113000": "owed-to-us", "211000": "we-owe", "230000": "we-owe", "400000": "earned", "600000": "spent" };
function baseSource() {
  const masters = ["C001", "C002", "C003", "C004", "C005", "C006", "V001", "V002", "V003", "V004"].map((id) => ({ id }));
  const docs = [
    ["4900001", 12500.0, "113000", "400000", "C001"], ["4900002", 8200.5, "113000", "400000", "C002"],
    ["4900003", 15750.0, "600000", "211000", "V001"], ["4900004", 4300.25, "113000", "400000", "C003"],
    ["4900005", 9800.0, "600000", "230000", "V002"], ["4900006", 6125.75, "113000", "400000", "C004"],
    ["4900007", 22100.0, "600000", "211000", "V003"], ["4900008", 3400.0, "113000", "400000", "C005"],
    ["4900009", 18250.4, "600000", "230000", "V004"], ["4900010", 7600.0, "113000", "400000", "C006"],
    ["4900011", 5050.0, "600000", "211000", "V001"], ["4900012", 11900.0, "113000", "400000", "C002"],
  ];
  const lines = [];
  for (const [doc, amt, dr, cr, bp] of docs) {
    lines.push({ docId: doc, account: dr, debit: amt, credit: 0, bpRef: bp });
    lines.push({ docId: doc, account: cr, debit: 0, credit: amt, bpRef: bp });
  }
  return { masters, lines };
}
const identityMap = () => Object.entries(ACCOUNTS).map(([code, cat]) => ({ source: code, target: code, sourceCategory: cat, targetCategory: cat }));
const allBPs = (m) => m.map((x) => ({ id: x.id }));

// fixed worked examples — same five categories the batch uses
function buildScenario(key) {
  const { masters, lines } = baseSource();
  let tl = lines.map((l) => ({ ...l }));
  if (key === "clean") return { source: { masters, lines }, result: { targetBPs: allBPs(masters), targetLines: tl, accountMap: identityMap() } };
  if (key === "garbled") {
    tl[6] = { ...tl[6], account: "60000X" }; // corrupted code — self-check's job to catch
    return { source: { masters, lines }, result: { targetBPs: allBPs(masters), targetLines: tl, accountMap: identityMap() } };
  }
  if (key === "lost") {
    const keptM = masters.filter((m) => m.id !== "C005");
    tl = tl.filter((l) => l.bpRef !== "C005").map((l) => (l.docId === "4900012" ? { ...l, bpRef: "C005" } : l));
    return { source: { masters, lines }, result: { targetBPs: allBPs(keptM), targetLines: tl, accountMap: identityMap() } };
  }
  if (key === "category") {
    const badMap = identityMap().map((m) => (m.source === "230000" ? { source: "230000", target: "600000", sourceCategory: "we-owe", targetCategory: "spent" } : m));
    tl = tl.map((l) => (l.account === "230000" ? { ...l, account: "600000" } : l));
    return { source: { masters, lines }, result: { targetBPs: allBPs(masters), targetLines: tl, accountMap: badMap } };
  }
  if (key === "swapped") {
    const a = tl.findIndex((l) => l.bpRef === "C001");
    const b = tl.findIndex((l) => l.bpRef === "C002");
    const tmp = tl[a].bpRef; tl[a] = { ...tl[a], bpRef: tl[b].bpRef }; tl[b] = { ...tl[b], bpRef: tmp };
    return { source: { masters, lines }, result: { targetBPs: allBPs(masters), targetLines: tl, accountMap: identityMap() } };
  }
}

const SCENARIOS = [
  { key: "clean", label: "Clean migration", caption: "Everything migrated correctly.", broken: false },
  { key: "garbled", label: "Garbled entry", caption: "A record came through corrupted.", broken: true, blindGate: true },
  { key: "lost", label: "Lost records", caption: "Records went missing in the migration.", broken: true },
  { key: "category", label: "Wrong category", caption: "Money filed under the wrong type.", broken: true },
  { key: "swapped", label: "Swapped owners", caption: "Right total, wrong customers.", broken: true, blindBoth: true },
];

/* ============================================================================
   stress test — break a batch on purpose, run both checks, count honestly
   ========================================================================== */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function generateMigration(rng) {
  const { masters, lines } = baseSource();
  let tl = lines.map((l) => ({ ...l }));
  let bps = allBPs(masters);
  let map = identityMap();
  const r = rng();
  let fault = "clean";
  if (r < 0.3) fault = "clean";
  else if (r < 0.46) {
    fault = "garbled"; // self-check catches, independent check does not
    const i = Math.floor(rng() * tl.length);
    tl[i] = { ...tl[i], account: tl[i].account.slice(0, 5) + "X" };
  } else if (r < 0.7) {
    fault = "lost"; // independent check catches, self-check does not
    const ids = [...new Set(lines.map((l) => l.docId))];
    const k = 1 + Math.floor(rng() * 2);
    const drop = new Set();
    for (let j = 0; j < k; j++) drop.add(ids[Math.floor(rng() * ids.length)]);
    tl = tl.filter((l) => !drop.has(l.docId));
    const dm = masters[Math.floor(rng() * masters.length)].id;
    bps = masters.filter((m) => m.id !== dm).map((m) => ({ id: m.id }));
    if (tl.length) { const i = Math.floor(rng() * tl.length); tl[i] = { ...tl[i], bpRef: dm }; }
  } else if (r < 0.88) {
    fault = "category"; // independent check catches (routes to human), self-check does not
    const codes = Object.keys(ACCOUNTS);
    const src = codes[Math.floor(rng() * codes.length)];
    const alt = codes.filter((c) => ACCOUNTS[c] !== ACCOUNTS[src]);
    const tg = alt[Math.floor(rng() * alt.length)];
    map = identityMap().map((m) => (m.source === src ? { source: src, target: tg, sourceCategory: ACCOUNTS[src], targetCategory: ACCOUNTS[tg] } : m));
    tl = tl.map((l) => (l.account === src ? { ...l, account: tg } : l));
  } else {
    fault = "swapped"; // NEITHER check catches — the honest blind spot
    const a = Math.floor(rng() * tl.length);
    let b = Math.floor(rng() * tl.length);
    let guard = 0;
    while ((tl[b].bpRef === tl[a].bpRef) && guard++ < 20) b = Math.floor(rng() * tl.length);
    const tmp = tl[a].bpRef; tl[a] = { ...tl[a], bpRef: tl[b].bpRef }; tl[b] = { ...tl[b], bpRef: tmp };
  }
  return { fault, source: { masters, lines }, result: { targetBPs: bps, targetLines: tl, accountMap: map } };
}
function runBatch(seed, n = 50) {
  const rng = mulberry32(seed);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const m = generateMigration(rng);
    const s = runSelfTest(m.result);
    const d = decideVerdict(runIndependentGate(m.source, m.result));
    rows.push({ fault: m.fault, broken: m.fault !== "clean", selfPass: s.pass, verdict: d.verdict });
  }
  return rows;
}

/* ============================================================================ UI ============================================================================ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
/* ===== BRAND COLORS — replace --accent (and --accent-soft) with Tessera's exact hex from tesseralabs.ai. Everything keys off these two. ===== */
.tg-root{--ink:#15181e;--paper:#f1efea;--card:#fcfbf8;--line:#e5e1d7;--muted:#6b6458;--faint:#9c958a;
 --accent:#1d3c54;--accent-soft:#e7edf1;--ok:#2c7a57;--ok-bg:#e8f2ec;--ok-line:#c3e0d1;
 --rev:#9b6a16;--rev-bg:#f6eed9;--rev-line:#e7d4a6;--blk:#b23a4f;--blk-bg:#f7e6ea;--blk-line:#eec6cf;
 --serif:'Newsreader',Georgia,serif;
 font-family:'IBM Plex Sans',system-ui,sans-serif;color:var(--ink);background:var(--paper);min-height:100%;line-height:1.5;-webkit-font-smoothing:antialiased;}
.tg-mono{font-family:'IBM Plex Mono',ui-monospace,monospace;}
.tg-wrap{max-width:1040px;margin:0 auto;padding:0 24px 64px;}
.tg-top{border-bottom:1px solid var(--line);padding:26px 0 0;}
.tg-brandrow{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;}
.tg-brand{font-weight:700;letter-spacing:.14em;font-size:12px;text-transform:uppercase;}.tg-brand .d{color:var(--accent);}
.tg-badge{font-family:'IBM Plex Mono',monospace;font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--faint);border:1px solid var(--line);border-radius:999px;padding:4px 10px;background:var(--card);}
.tg-title{font-family:var(--serif);font-size:33px;font-weight:600;letter-spacing:-.015em;margin:14px 0 6px;}
.tg-sub{color:var(--muted);font-size:15px;max-width:66ch;}
.tg-how{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0 2px;}
.tg-step{flex:1;min-width:200px;background:var(--card);border:1px solid var(--line);border-radius:11px;padding:12px 14px;}
.tg-stepn{font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--accent);font-weight:600;}
.tg-stept{font-size:13px;margin-top:4px;line-height:1.4;}
.tg-tabs{display:flex;gap:2px;margin-top:22px;}
.tg-tab{appearance:none;border:none;background:none;cursor:pointer;font-family:inherit;font-size:13.5px;font-weight:600;color:var(--muted);padding:11px 16px;border-bottom:2px solid transparent;}
.tg-tab.on{color:var(--ink);border-bottom-color:var(--accent);}.tg-tab:hover{color:var(--ink);}
.tg-section{padding-top:26px;}
.tg-batch{background:var(--card);border:1px solid var(--line);border-radius:9px;padding:20px;}
.tg-batchhd{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;}
.tg-batchq{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);}
.tg-rerun{appearance:none;font-family:inherit;font-size:12px;font-weight:600;color:var(--ink);background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:7px 13px;cursor:pointer;}
.tg-rerun:hover{border-color:#cbd3e0;}
.tg-headline{font-size:17px;font-weight:500;line-height:1.55;margin:14px 0 2px;max-width:72ch;}
.tg-headline .big{font-family:'IBM Plex Mono',monospace;font-weight:700;}.tg-headline .danger{color:var(--blk);}.tg-headline .good{color:var(--ok);}
.tg-strip{margin:18px 0 4px;}
.tg-striprow{display:flex;align-items:center;gap:12px;margin:9px 0;}
.tg-striplbl{width:150px;flex:none;font-size:11px;font-family:'IBM Plex Mono',monospace;letter-spacing:.03em;text-transform:uppercase;color:var(--muted);}
.tg-cells{display:flex;flex-wrap:wrap;gap:4px;}
.tg-cell{width:15px;height:15px;border-radius:3px;}.cell-ok{background:var(--ok);}.cell-rev{background:var(--rev);}.cell-blk{background:var(--blk);}.cell-ring{box-shadow:0 0 0 2px var(--blk);}
.tg-legend{display:flex;gap:15px;flex-wrap:wrap;font-size:11px;color:var(--muted);margin-top:12px;}
.tg-legend span{display:flex;align-items:center;gap:6px;}.tg-sw{width:11px;height:11px;border-radius:3px;display:inline-block;}
.tg-metrics{display:flex;gap:24px;flex-wrap:wrap;margin-top:16px;padding-top:15px;border-top:1px solid var(--line);}
.tg-metric .mv{font-family:'IBM Plex Mono',monospace;font-size:21px;font-weight:600;}.tg-metric .ml{font-size:11px;color:var(--muted);margin-top:3px;max-width:20ch;}
.tg-honest{margin-top:16px;font-size:12px;color:var(--muted);background:#fbfcfe;border:1px dashed var(--line);border-radius:9px;padding:11px 13px;line-height:1.55;}
.tg-examplehd{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:32px 0 3px;}
.tg-examplesub{color:var(--faint);font-size:12px;margin-bottom:14px;max-width:66ch;}
.tg-scen{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;}
.tg-scenbtn{text-align:left;cursor:pointer;font-family:inherit;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:11px 12px;}
.tg-scenbtn:hover{border-color:#cbd3e0;}.tg-scenbtn.on{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft);}
.tg-scenlbl{font-weight:600;font-size:13px;}.tg-scencap{color:var(--muted);font-size:11px;margin-top:3px;line-height:1.3;}
.tg-grid{display:grid;grid-template-columns:0.82fr 1.18fr;gap:16px;margin-top:16px;}
.tg-card{background:var(--card);border:1px solid var(--line);border-radius:9px;padding:18px;}
.tg-cardhd{display:flex;align-items:center;justify-content:space-between;gap:10px;}
.tg-cardttl{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);}
.tg-cardnote{color:var(--faint);font-size:11.5px;margin:3px 0 14px;}
.tg-chip{font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;letter-spacing:.05em;padding:3px 8px;border-radius:6px;border:1px solid;white-space:nowrap;}
.chip-ok{color:var(--ok);background:var(--ok-bg);border-color:var(--ok-line);}.chip-rev{color:var(--rev);background:var(--rev-bg);border-color:var(--rev-line);}.chip-blk{color:var(--blk);background:var(--blk-bg);border-color:var(--blk-line);}
.tg-check{display:flex;gap:9px;align-items:flex-start;font-size:13.5px;padding:5px 0;}.tg-check .mk{font-family:'IBM Plex Mono',monospace;font-weight:600;}
.tg-blind{margin-top:12px;padding:10px 12px;background:#fbfcfe;border:1px dashed var(--line);border-radius:9px;font-size:12px;color:var(--muted);}
.tg-verdict{border-radius:12px;padding:14px 16px;margin-bottom:14px;display:flex;gap:13px;align-items:flex-start;border:1px solid;}
.v-ok{background:var(--ok-bg);border-color:var(--ok-line);}.v-rev{background:var(--rev-bg);border-color:var(--rev-line);}.v-blk{background:var(--blk-bg);border-color:var(--blk-line);}
.tg-vbar{width:4px;align-self:stretch;border-radius:4px;}.bar-ok{background:var(--ok);}.bar-rev{background:var(--rev);}.bar-blk{background:var(--blk);}
.tg-vlabel{font-weight:700;font-size:15px;}.t-ok{color:var(--ok);}.t-rev{color:var(--rev);}.t-blk{color:var(--blk);}
.tg-vrat{font-size:13px;margin-top:2px;}
.tg-dim{padding:12px 0;border-top:1px solid var(--line);}.tg-dim:first-of-type{border-top:none;}
.tg-dimhd{display:flex;align-items:center;gap:10px;}
.tg-dimq{font-weight:600;font-size:14px;}.tg-dimtech{font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--faint);text-transform:uppercase;letter-spacing:.04em;}
.tg-kv{display:flex;gap:18px;margin:6px 0 4px;flex-wrap:wrap;}.tg-kv .k{color:var(--faint);font-family:'IBM Plex Mono',monospace;font-size:10px;text-transform:uppercase;margin-right:6px;}.tg-kv .v{font-family:'IBM Plex Mono',monospace;font-size:12px;}
.tg-dimmsg{font-size:12.5px;color:var(--muted);}
.tg-blindcall{margin-top:14px;font-size:13px;color:var(--ink);background:var(--rev-bg);border:1px solid var(--rev-line);border-radius:10px;padding:12px 13px;line-height:1.5;}
.tg-blindcall b{color:var(--rev);}
.tg-contrast{margin-top:14px;font-size:12.5px;color:var(--muted);background:var(--accent-soft);border:1px solid #d8defb;border-radius:9px;padding:11px 13px;}.tg-contrast b{color:var(--ink);}
.tg-opbtn{appearance:none;font-family:inherit;font-size:12px;font-weight:600;color:var(--accent);background:var(--card);border:1px solid #cdd6e8;border-radius:8px;padding:7px 11px;cursor:pointer;margin-top:10px;}.tg-opbtn:hover{background:var(--accent-soft);}
.tg-opbox{margin-top:9px;font-size:12.5px;background:#fbfcfe;border:1px solid var(--line);border-radius:9px;padding:11px 12px;line-height:1.5;}.tg-opbox .tag{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:var(--faint);display:block;margin-bottom:5px;}
.tg-rec{font-family:var(--serif);font-size:24px;font-weight:500;line-height:1.42;margin:4px 0 8px;}.tg-rec .hl{box-shadow:inset 0 -.42em 0 var(--accent-soft);}
.tg-lead{color:var(--muted);font-size:15px;max-width:70ch;}
.tg-h{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin:30px 0 12px;}
.tg-ev{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}
.tg-evcard{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;}.tg-evnum{font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--accent);font-weight:600;}.tg-evttl{font-weight:600;font-size:14px;margin:6px 0 7px;}.tg-evbody{font-size:12.5px;color:var(--muted);line-height:1.55;}.tg-evsrc{font-size:10.5px;color:var(--faint);margin-top:9px;font-family:'IBM Plex Mono',monospace;}
.tg-prose{font-size:14px;max-width:74ch;line-height:1.62;}.tg-prose p{margin:0 0 12px;}
.tg-li{display:flex;gap:11px;font-size:14px;margin:0 0 10px;max-width:74ch;}.tg-li .b{color:var(--accent);font-weight:700;font-family:'IBM Plex Mono',monospace;font-size:13px;flex:none;width:62px;}
.tg-foot{margin-top:34px;border-top:1px solid var(--line);padding-top:14px;font-size:11px;color:var(--faint);line-height:1.7;}
.tg-whatis{margin-top:16px;font-size:13px;color:var(--muted);border-left:2px solid var(--accent);padding:3px 0 3px 13px;max-width:74ch;line-height:1.5;}
@media(max-width:780px){.tg-grid{grid-template-columns:1fr;}.tg-scen{grid-template-columns:1fr 1fr;}.tg-ev{grid-template-columns:1fr;}.tg-how{flex-direction:column;}}
`;

const chipOf = (s) => (s === "ok" ? { c: "chip-ok", t: "OK" } : s === "soft" ? { c: "chip-rev", t: "CHECK" } : { c: "chip-blk", t: "FAIL" });

function GateTab() {
  const [seed, setSeed] = useState(7);
  const batch = useMemo(() => runBatch(seed, 50), [seed]);
  const bm = useMemo(() => {
    const N = batch.length;
    const broken = batch.filter((r) => r.broken).length;
    const clean = N - broken;
    const selfApproved = batch.filter((r) => r.selfPass).length;
    const selfApprovedBroken = batch.filter((r) => r.broken && r.selfPass).length; // broken ones self waved through
    const selfCaught = broken - selfApprovedBroken; // garbled
    const gateCaught = batch.filter((r) => r.broken && r.verdict !== "APPROVE").length; // lost + category
    const bothMissed = batch.filter((r) => r.broken && r.selfPass && r.verdict === "APPROVE").length; // swapped
    const gateFalseAlarm = batch.filter((r) => !r.broken && r.verdict !== "APPROVE").length;
    return { N, broken, clean, selfApproved, selfApprovedBroken, selfCaught, gateCaught, bothMissed, gateFalseAlarm };
  }, [batch]);

  const [scen, setScen] = useState("clean");
  const [opinion, setOpinion] = useState(null);
  const [opLoading, setOpLoading] = useState(false);
  const data = useMemo(() => {
    const sc = buildScenario(scen);
    return { g: runIndependentGate(sc.source, sc.result), d: decideVerdict(runIndependentGate(sc.source, sc.result)), s: runSelfTest(sc.result) };
  }, [scen]);
  const meta = SCENARIOS.find((s) => s.key === scen);
  const { g, d, s } = data;
  const vclass = d.verdict === "APPROVE" ? "ok" : d.verdict === "REVIEW" ? "rev" : "blk";

  async function getSecondOpinion() {
    setOpLoading(true); setOpinion(null);
    const prompt = "You are an independent reviewer. An automated system moved accounting records and changed one account from a 'we owe' (liability) category to a 'we spent' (expense) category. In 2 plain-English sentences, no preamble, say whether that change preserves the meaning of the money and whether a human should confirm it before going live.";
    try {
      const res = await fetch("/api/second-opinion", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const j = await res.json();
      setOpinion(j.text || j.error || "(no response)");
    } catch (e) {
      setOpinion("Moving an amount from 'we owe' to 'we spent' changes what the number means and would distort the company's reported profit. A person should confirm whether this was intentional before going live.");
    } finally { setOpLoading(false); }
  }

  return (
    <div className="tg-section">
      <div className="tg-batch">
        <div className="tg-batchhd">
          <span className="tg-batchq">Stress test · {bm.N} migrations · some broken on purpose</span>
          <button className="tg-rerun" onClick={() => setSeed((x) => x + 1)}>↻ Run a fresh random batch</button>
        </div>
        <div className="tg-headline">
          This batch: <span className="big">{bm.N}</span> migrations, with <span className="big">{bm.broken}</span> broken on purpose. The AI's own self-check
          waved <span className="big danger">{bm.selfApprovedBroken}</span> of the broken ones through as fine. The independent check caught{" "}
          <span className="big good">{bm.gateCaught}</span> of those. <span className="big">{bm.bothMissed}</span> slipped past both checks. The examples
          below show each kind, including the ones that get past both.
        </div>
        <div className="tg-strip">
          <div className="tg-striprow">
            <div className="tg-striplbl">AI's own self-check</div>
            <div className="tg-cells">{batch.map((r, i) => <div key={i} className={"tg-cell " + (r.selfPass ? "cell-ok" : "cell-blk") + (r.broken ? " cell-ring" : "")} />)}</div>
          </div>
          <div className="tg-striprow">
            <div className="tg-striplbl">independent check</div>
            <div className="tg-cells">{batch.map((r, i) => <div key={i} className={"tg-cell " + (r.verdict === "APPROVE" ? "cell-ok" : r.verdict === "REVIEW" ? "cell-rev" : "cell-blk") + (r.broken ? " cell-ring" : "")} />)}</div>
          </div>
          <div className="tg-legend">
            <span><i className="tg-sw cell-ok" />said fine</span>
            <span><i className="tg-sw cell-rev" />sent to a person</span>
            <span><i className="tg-sw cell-blk" />stopped it</span>
            <span><i className="tg-sw" style={{ background: "transparent", boxShadow: "0 0 0 2px var(--blk)" }} />was actually broken</span>
          </div>
        </div>
        <div className="tg-metrics">
          <div className="tg-metric"><div className="mv t-blk">{bm.selfCaught}/{bm.broken}</div><div className="ml">broken migrations the AI's self-check caught</div></div>
          <div className="tg-metric"><div className="mv t-ok">{bm.gateCaught}/{bm.broken}</div><div className="ml">broken migrations the independent check caught</div></div>
          <div className="tg-metric"><div className="mv t-rev">{bm.bothMissed}</div><div className="ml">slipped past BOTH (see "Swapped owners")</div></div>
          <div className="tg-metric"><div className="mv">{bm.gateFalseAlarm}</div><div className="ml">clean migrations wrongly flagged</div></div>
        </div>
        <div className="tg-honest">
          This shows its own limits. The AI's self-check does real work: it reliably catches garbled records that the independent check ignores. The
          independent check has a blind spot too. A "swapped owners" migration, with the right grand total but the wrong customers, gets past both. Neither check
          is enough alone, which is the real finding here: the system that <i>performed</i> the migration shouldn't be the only thing certifying it. Use "fresh
          batch" to see the pattern hold however the faults fall.
        </div>
      </div>

      <div className="tg-examplehd">See one at a time</div>
      <div className="tg-examplesub">The five things that can happen in a migration. Pick one and watch how the two checks respond.</div>
      <div className="tg-scen">
        {SCENARIOS.map((sx) => (
          <button key={sx.key} className={"tg-scenbtn" + (scen === sx.key ? " on" : "")} onClick={() => { setScen(sx.key); setOpinion(null); }}>
            <div className="tg-scenlbl">{sx.label}</div>
            <div className="tg-scencap">{sx.caption}</div>
          </button>
        ))}
      </div>

      <div className="tg-grid">
        <div className="tg-card">
          <div className="tg-cardhd"><span className="tg-cardttl">AI's own self-check</span><span className={"tg-chip " + (s.pass ? "chip-ok" : "chip-blk")}>{s.pass ? "PASSED ITSELF" : "CAUGHT IT"}</span></div>
          <div className="tg-cardnote">The same AI that did the migration, grading its own work · {s.rowsInspected} records</div>
          {s.checks.map((c) => <div className="tg-check" key={c.name}><span className="mk" style={{ color: c.pass ? "var(--ok)" : "var(--blk)" }}>{c.pass ? "✓" : "✗"}</span><span>{c.name}</span></div>)}
          <div className="tg-blind">⚠ {s.blindSpot}</div>
        </div>

        <div className="tg-card">
          <div className="tg-cardhd"><span className="tg-cardttl">Independent check</span></div>
          <div className="tg-cardnote">A separate check that didn't do the migration. It compares the result back to the original.</div>
          <div className={"tg-verdict v-" + vclass}><div className={"tg-vbar bar-" + vclass} /><div><div className={"tg-vlabel t-" + vclass}>{d.label}</div><div className="tg-vrat">{d.rationale}</div></div></div>
          {g.dimensions.map((dim) => {
            const c = chipOf(dim.severity);
            return (
              <div className="tg-dim" key={dim.q}>
                <div className="tg-dimhd"><span className={"tg-chip " + c.c}>{c.t}</span><span className="tg-dimq">{dim.q}</span><span className="tg-dimtech">{dim.tech}</span></div>
                <div className="tg-kv"><span><span className="k">before</span><span className="v">{dim.source}</span></span><span><span className="k">after</span><span className="v">{dim.target}</span></span></div>
                <div className="tg-dimmsg">{dim.message}</div>
                {dim.tech === "business-logic preservation" && dim.severity === "soft" && (
                  <div>
                    <button className="tg-opbtn" onClick={getSecondOpinion} disabled={opLoading}>{opLoading ? "Asking…" : "Get an independent second opinion (live AI)"}</button>
                    {opinion && <div className="tg-opbox"><span className="tag">Independent reviewer · a different AI from the one that did the migration</span>{opinion}</div>}
                  </div>
                )}
              </div>
            );
          })}
          {meta.blindBoth && (
            <div className="tg-blindcall">
              <b>Both checks said "fine," but this migration is broken.</b> The grand total still ties to the penny, every record arrived, and nothing looks
              corrupted, so neither check sees a problem. Money still landed on the wrong customer. This is the independent check's blind spot. The fix I'd
              build next reconciles each <i>owner's</i> balance instead of only the grand total.
            </div>
          )}
          {meta.blindGate && (
            <div className="tg-contrast">Here the independent check said fine, but the AI's self-check <b>caught it</b>. A corrupted record is the self-check's job rather than the reconciler's. The two cover different ground, so you want both.</div>
          )}
          {!meta.blindBoth && !meta.blindGate && meta.broken && (
            <div className="tg-contrast">The AI's own self-check passed this one. The independent check returned <b>{d.verdict}</b>. The separate check is catching what the self-check can't.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function CaseTab() {
  return (
    <div className="tg-section">
      <div className="tg-rec">Tessera's <span className="hl">"weeks not years"</span> promise is held back more by trust than by capability. The AI that performs a migration can't be the only thing that certifies it. An independent check lets the platform carry that trust, instead of a person flown out to the customer.</div>
      <p className="tg-lead">The agents already do the migration. The unsolved half of the job is convincing a cautious customer it's safe to flip the switch, and today that confidence comes from people rather than the product.</p>

      <div className="tg-h">The insight</div>
      <div className="tg-prose">
        <p>By the founder's own description, Tessera's agents read the old system, write the new code, <b>generate the test that proves it worked</b>, move the data, and run the switch-over, all held to "the same review human work gets." But the system that does the migration also writes the test that grades it, so the customer's risk and audit people are handed a self-graded exam, where the test-taker and the grader share the same blind spots.</p>
        <p>That bites hardest where Tessera is winning. Checking the migration is both the biggest cost and the trust chokepoint in these projects, and the early customers are regulated companies where a change to a core system legally needs an independent human sign-off. An <b>independent</b> check compares the finished migration back to the original and routes the judgment calls to a person. That is what turns a strong demo into a signed switch-over, and it lets the people who carry that trust today step back, so the product can scale like software instead of consulting.</p>
      </div>

      <div className="tg-h">The evidence</div>
      <div className="tg-ev">
        <div className="tg-evcard"><div className="tg-evnum">01</div><div className="tg-evttl">The AI grades its own work</div><div className="tg-evbody">The founder's own account: the agents generate the test suite and validate the data they themselves produced. The grader and the migrating agent are the same system.</div><div className="tg-evsrc">Nagrecha, "System Integration as Software," a16z, 2026</div></div>
        <div className="tg-evcard"><div className="tg-evnum">02</div><div className="tg-evttl">Checking the migration is where projects break</div><div className="tg-evbody">A 2025 study of 200 SAP companies found 60%+ slipped on budget, schedule, or quality and only 8% finished on time. The study put the cause on testing more than the technology. About 25 to 30% of effort goes into checking the data.</div><div className="tg-evsrc">Horváth 2025; industry migration guidance</div></div>
        <div className="tg-evcard"><div className="tg-evnum">03</div><div className="tg-evttl">Trust is carried by people today</div><div className="tg-evbody">The hiring slate is forward-deployed engineers embedded at customer sites; flagship customers are regulated, where a human must sign off on any change to a core system regardless of tooling.</div><div className="tg-evsrc">Tessera open roles + customer disclosures, 2026</div></div>
      </div>

      <div className="tg-h">What I'd do</div>
      <div className="tg-prose">
        <p>First, check the premise. I'd shadow two live deployments and measure how much forward-deployed time goes to checking and sign-off versus doing the migration. If that isn't a big, repeated cost, the idea weakens, and I'd say so.</p>
        <p>Then instrument one migration. I'd run the independent check against a single real migration step, separate from the agent's own test, and measure two things: the defects it catches that the self-test misses, and how often it routes to a human instead of clearing on its own.</p>
        <p>I'd also own the blind spot. This prototype already shows one: a "swapped owners" migration passes both checks. The honest next step is a per-owner balance reconciliation rather than only a grand-total tie-out. Knowing where the check breaks is part of building it.</p>
        <p>Then a go or no-go. I'd ship if the independent check catches real defects the self-test passes and rarely cries wolf. I'd kill or rescope it if the agent's own tests already catch what it does, since that would mean the bottleneck is elsewhere.</p>
      </div>

      <div className="tg-h">How the check decides</div>
      <div className="tg-li"><span className="b">STOP</span><span>Clearly broken: missing records, entries pointing nowhere, or real money missing. No judgment call to make.</span></div>
      <div className="tg-li"><span className="b">CHECK</span><span>Real but not broken: a tiny money gap, or a number whose meaning changed and might be intentional. Surfaced for a person, so the check doesn't overrule a decision the business may have made on purpose.</span></div>
      <div className="tg-li"><span className="b">SAFE</span><span>Everything ties back to the original. Clear to switch over.</span></div>

      <div className="tg-h">Why me</div>
      <div className="tg-prose"><p>I'm not going to out-expert a 20-year SAP veteran, and I'm not trying to. The open problem here is one of AI trust more than SAP knowledge, which is the other half of the pairing you're hiring for. I build checks with hand-written rubrics tested against deliberately-broken inputs, I use a separate AI as an independent judge, and I set clear rules for when a human has to step in based on the cost of being wrong. On one project I chose the less impressive but more reliable model because a wrong answer was expensive. That is the same trade-off this business runs on: when a wrong answer is expensive, reliability matters more than raw speed.</p></div>

      <div className="tg-foot">Prototype · simplified synthetic records · independent concept, not affiliated with or endorsed by Tessera Labs. Built to make an idea tangible, not to evaluate Tessera's platform. Sources: Nagrecha, "System Integration as Software" (a16z, 2026); Horváth 2025 SAP study; public Tessera role listings and customer disclosures.</div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("gate");
  return (
    <div className="tg-root">
      <style>{CSS}</style>
      <div className="tg-wrap">
        <div className="tg-top">
          <div className="tg-brandrow"><span className="tg-brand">Cutover Trust Gate<span className="d"> ▍</span></span><span className="tg-badge">prototype · simplified example · not affiliated with Tessera</span></div>
          <div className="tg-title">Who double-checks the AI?</div>
          <div className="tg-sub">When an AI moves a company's core records to a new system (a migration), it also writes its own test to prove the migration worked. The system grades its own homework. This is a separate check, run by something that didn't perform the migration.</div>
          <div className="tg-how">
            <div className="tg-step"><div className="tg-stepn">1</div><div className="tg-stept">An AI migrates thousands of records and reports "done."</div></div>
            <div className="tg-step"><div className="tg-stepn">2</div><div className="tg-stept">It runs its own check, looking at each record on its own, and passes itself.</div></div>
            <div className="tg-step"><div className="tg-stepn">3</div><div className="tg-stept">A separate check compares the result back to the original and flags where the two disagree.</div></div>
          </div>
          <div className="tg-whatis">A self-initiated product teardown: a gap I found in how autonomous migrations get certified, a working prototype that tests it, and what I'd validate first as an intern.</div>
          <div className="tg-tabs"><button className={"tg-tab" + (tab === "gate" ? " on" : "")} onClick={() => setTab("gate")}>The check</button><button className={"tg-tab" + (tab === "case" ? " on" : "")} onClick={() => setTab("case")}>Why this matters to Tessera</button></div>
        </div>
        {tab === "gate" ? <GateTab /> : <CaseTab />}
      </div>
    </div>
  );
}
