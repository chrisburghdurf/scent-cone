import {
  CHEMICAL_LIBRARY,
  computeAlarmState,
  renderAlarmState,
  triggerTypeLabel,
  updateCandidates,
  type CandidateScore,
  type EvidenceInput,
  type PhTendency,
} from "hazmat-core";

type NumericField = "pidPpm" | "fidPpm" | "o2Pct" | "lelPct" | "coPpm" | "h2sPpm";
type Observation = "unknown" | "positive" | "negative";

const numericFields: Array<[NumericField, string]> = [
  ["pidPpm", "PID ppm"],
  ["fidPpm", "FID ppm"],
  ["o2Pct", "O2 %"],
  ["lelPct", "LEL %"],
  ["coPpm", "CO ppm"],
  ["h2sPpm", "H2S ppm"],
];

const state = {
  selectedChemicalId: "",
  reduceFlashing: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  mixtureMode: false,
  oxidizerPositive: "unknown" as Observation,
  waterFinding: "unknown" as Observation,
  fluorideTest: "unknown" as Observation,
  m8Test: "unknown" as Observation,
  ph: "unknown" as PhTendency,
  draft: { pidPpm: "", fidPpm: "", o2Pct: "", lelPct: "", coPpm: "", h2sPpm: "" } as Record<NumericField, string>,
  input: {
    pidPpm: null,
    fidPpm: null,
    o2Pct: null,
    lelPct: null,
    coPpm: null,
    h2sPpm: null,
  } as Record<NumericField, number | null>,
  latched: false,
  acknowledged: false,
  timers: {} as Partial<Record<NumericField, ReturnType<typeof setTimeout>>>,
};

function getRequired<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element: ${id}`);
  return node as T;
}

const el = {
  shell: getRequired<HTMLElement>("shell"),
  banner: getRequired<HTMLElement>("banner"),
  bannerTitle: getRequired<HTMLElement>("bannerTitle"),
  line1: getRequired<HTMLElement>("bannerLine1"),
  line2: getRequired<HTMLElement>("bannerLine2"),
  line3: getRequired<HTMLElement>("bannerLine3"),
  ackBtn: getRequired<HTMLButtonElement>("ackBtn"),
  chemicalSelect: getRequired<HTMLSelectElement>("chemicalSelect"),
  tabDigital: getRequired<HTMLButtonElement>("tabDigital"),
  tabPaper: getRequired<HTMLButtonElement>("tabPaper"),
  panelDigital: getRequired<HTMLElement>("panelDigital"),
  panelPaper: getRequired<HTMLElement>("panelPaper"),
  reduceFlashing: getRequired<HTMLInputElement>("reduceFlashing"),
  mixtureMode: getRequired<HTMLInputElement>("mixtureMode"),
  oxidizerPositive: getRequired<HTMLSelectElement>("oxidizerPositive"),
  waterFinding: getRequired<HTMLSelectElement>("waterFinding"),
  fluorideTest: getRequired<HTMLSelectElement>("fluorideTest"),
  m8Test: getRequired<HTMLSelectElement>("m8Test"),
  ph: getRequired<HTMLSelectElement>("ph"),
  inputs: getRequired<HTMLElement>("inputs"),
  bars: getRequired<HTMLElement>("bars"),
  elim: getRequired<HTMLElement>("elim"),
  elimTitle: getRequired<HTMLElement>("elimTitle"),
  sopActions: getRequired<HTMLElement>("sopActions"),
};

function formatValue(value: number | null) {
  return value == null || Number.isNaN(value) ? "--" : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function addPaperSignalAdjustments(candidates: CandidateScore[]): CandidateScore[] {
  const adjusted = candidates.map((candidate) => {
    if (candidate.excluded) return candidate;

    let score = candidate.score;
    const supportReasons = [...candidate.supportReasons];
    const conflictReasons = [...candidate.conflictReasons];

    if (state.waterFinding === "positive") {
      if (candidate.chemical.flags.hydrocarbon) {
        score -= 4;
        conflictReasons.push("Water-finding paper positive can conflict with dry hydrocarbon profile.");
      } else {
        score += 2;
        supportReasons.push("Water-finding paper positive supports aqueous/contaminated sample possibility.");
      }
    }

    if (state.fluorideTest === "positive") {
      conflictReasons.push("Fluoride paper positive noted; expand chemical library with fluoride-bearing candidates.");
    }

    if (state.m8Test === "positive") {
      conflictReasons.push("M8 paper positive noted; treat as high-priority agent screening signal.");
    }

    return {
      ...candidate,
      score,
      supportReasons,
      conflictReasons,
    };
  });

  const survivors = adjusted.filter((c) => !c.excluded);
  const maxScore = survivors.length ? Math.max(...survivors.map((c) => c.score)) : 0;
  const minScore = survivors.length ? Math.min(...survivors.map((c) => c.score)) : 0;
  const cutoff = maxScore - 14;

  return adjusted
    .map((candidate) => {
      if (candidate.excluded) return { ...candidate, confidence: 0, eliminated: true };
      const spread = Math.max(1, maxScore - minScore);
      const normalized = Math.max(0, Math.min(1, (candidate.score - minScore) / spread));
      const confidence = Math.round(20 + normalized * 79);
      return { ...candidate, confidence, eliminated: candidate.score < cutoff };
    })
    .sort((a, b) => {
      if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
      return b.score - a.score;
    });
}

function buildSopActions(candidates: CandidateScore[], triggerActive: boolean, triggerType: string | null, threshold: number | null, reading: number | null) {
  const items: string[] = [];
  const knownChemical = !!state.selectedChemicalId;
  const top = candidates.filter((c) => !c.eliminated && !c.excluded).slice(0, 3);
  const topNames = top.map((c) => c.chemical.name).join(", ");

  if (knownChemical) {
    items.push("Known chemical flow: Dispatch Chart 1 -> Respond Book 2 -> Arrival Meters 3 -> Entry Mission 4.");
  } else {
    items.push("Unknown/mixture flow: Start at Meters 3, verify with Book 2, then apply Chart 1 and Mission 4.");
  }

  if (triggerActive) {
    items.push("Above the Line: Turnout and SCBA, Level B/MOPP posture, and establish initial hot zone (300 ft).");
  } else {
    items.push("Below the Line posture until critical thresholds are exceeded, then transition to Above the Line.");
  }

  if (triggerType === "idlh") {
    const mode = knownChemical ? "confirmed" : "potential";
    items.push(`IDLH trigger (${mode}) active: reading ${formatValue(reading)} vs threshold ${formatValue(threshold)}.`);
  }

  if (triggerType === "o2" || triggerType === "lel") {
    items.push("Mission-driven red light/green light check and apply the 3-30 rule for rescue go/no-go decisions.");
  }

  if ((state.input.pidPpm ?? 0) > 0 || (state.input.fidPpm ?? 0) > 0) {
    items.push("Cross-check PID/FID pattern for toxics and flammability; validate with CGI/LEL behavior.");
  }

  if (state.ph !== "unknown") {
    items.push(`Universal pH result is ${state.ph}; verify corrosivity pathway and confirm with secondary meter/paper.`);
  }

  if (state.oxidizerPositive === "positive") {
    items.push("KI starch positive: treat as oxidizer-involved hazard until disproven.");
  }

  if (state.waterFinding === "positive") {
    items.push("Water-finding positive: account for water/solvent interaction and contamination effects.");
  }

  if (state.fluorideTest === "positive") {
    items.push("Fluoride paper positive: prioritize fluoride-bearing candidate set and escalate PPE/monitoring.");
  }

  if (state.m8Test === "positive") {
    items.push("M8 positive indication: treat as high-priority nerve/blister screening signal and isolate area.");
  }

  if (topNames) {
    items.push(`Current best-fit candidates: ${topNames}. Continue elimination with meter + paper confirmation.`);
  }

  items.push("Maintain mission-driven objective: plumbing, identify, make it safe, then re-evaluate conditions.");
  return items;
}

function render() {
  const evidence: EvidenceInput = {
    ...state.input,
    ph: state.ph,
    oxidizerPositive: state.oxidizerPositive === "positive",
    mixtureMode: state.mixtureMode,
  };

  const baseline = updateCandidates(evidence, CHEMICAL_LIBRARY);
  const candidates = addPaperSignalAdjustments(baseline);
  const alarmEval = computeAlarmState({
    readingValue: state.input.pidPpm,
    readingLabel: "PID ppm",
    o2Pct: state.input.o2Pct,
    lelPct: state.input.lelPct,
    candidates,
    selectedChemicalId: state.selectedChemicalId || null,
  });

  if (alarmEval.triggerActive) {
    state.latched = true;
    state.acknowledged = false;
  }

  const canClear =
    state.latched &&
    !alarmEval.triggerActive &&
    state.acknowledged &&
    (alarmEval.clearThreshold == null || alarmEval.readingValue == null || alarmEval.readingValue < alarmEval.clearThreshold);

  if (canClear) {
    state.latched = false;
    state.acknowledged = false;
  }

  if (state.latched) {
    el.banner.style.display = "block";
    el.bannerTitle.textContent = triggerTypeLabel(alarmEval.triggerType);
    el.line1.textContent = `Reading: ${formatValue(alarmEval.readingValue)} ${alarmEval.readingLabel}${
      alarmEval.threshold != null ? ` / Threshold: ${formatValue(alarmEval.threshold)}` : ""
    }`;
    el.line2.textContent = `${alarmEval.potential ? "POTENTIAL IDLH" : "CONFIRMED"} • ${alarmEval.sourceLabel}`;
    el.line3.textContent = `State: ${renderAlarmState({
      latched: state.latched,
      acknowledged: state.acknowledged,
      selectedChemicalId: state.selectedChemicalId || null,
    })}`;
    el.ackBtn.disabled = state.acknowledged;
    el.ackBtn.textContent = state.acknowledged ? "Acknowledged" : "Acknowledge";

    el.shell.classList.remove("alarm-flash", "alarm-solid");
    if (state.reduceFlashing) el.shell.classList.add("alarm-solid");
    else el.shell.classList.add("alarm-flash");
  } else {
    el.banner.style.display = "none";
    el.shell.classList.remove("alarm-flash", "alarm-solid");
  }

  const tops = candidates.filter((c) => !c.eliminated).slice(0, 6);
  const eliminated = candidates.filter((c) => c.eliminated);

  el.bars.innerHTML = tops
    .map(
      (candidate) => `
        <details>
          <summary><span>${candidate.chemical.name}</span><span>${candidate.confidence}%</span></summary>
          <div class="bar"><div class="fill" style="width:${candidate.confidence}%"></div></div>
          <div class="why">
            ${candidate.supportReasons.slice(0, 4).map((reason) => `<p class="ok">+ ${reason}</p>`).join("")}
            ${candidate.conflictReasons.slice(0, 3).map((reason) => `<p class="bad">- ${reason}</p>`).join("")}
          </div>
        </details>
      `,
    )
    .join("");

  el.elimTitle.textContent = `Eliminated (${eliminated.length})`;
  el.elim.innerHTML = eliminated
    .map((candidate) => `<p>${candidate.chemical.name}: ${candidate.exclusionReasons[0] || "Lower-fit score after new evidence."}</p>`)
    .join("");

  const sopItems = buildSopActions(
    candidates,
    alarmEval.triggerActive,
    alarmEval.triggerType,
    alarmEval.threshold,
    alarmEval.readingValue,
  );
  el.sopActions.innerHTML = sopItems.map((item) => `<li>${item}</li>`).join("");
}

function init() {
  el.chemicalSelect.innerHTML =
    '<option value="">Unknown (candidate mode)</option>' +
    CHEMICAL_LIBRARY.map((chemical) => `<option value="${chemical.id}">${chemical.name} - IDLH ${chemical.idlhPpm} ppm</option>`).join("");

  el.reduceFlashing.checked = state.reduceFlashing;
  el.oxidizerPositive.value = state.oxidizerPositive;
  el.waterFinding.value = state.waterFinding;
  el.fluorideTest.value = state.fluorideTest;
  el.m8Test.value = state.m8Test;
  el.ph.value = state.ph;

  for (const [field, label] of numericFields) {
    const wrap = document.createElement("label");
    wrap.textContent = label;
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Enter value";
    input.value = state.draft[field];

    const commit = () => {
      const raw = state.draft[field].trim();
      const num = raw === "" ? null : Number(raw);
      state.input[field] = num != null && Number.isFinite(num) ? num : null;
      render();
    };

    input.addEventListener("input", (event) => {
      const target = event.target as HTMLInputElement;
      state.draft[field] = target.value;
      if (state.timers[field]) clearTimeout(state.timers[field]);
      state.timers[field] = setTimeout(commit, 1000);
    });

    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") commit();
    });

    wrap.appendChild(input);
    el.inputs.appendChild(wrap);
  }

  el.chemicalSelect.addEventListener("change", (event) => {
    state.selectedChemicalId = (event.target as HTMLSelectElement).value;
    render();
  });

  el.reduceFlashing.addEventListener("change", (event) => {
    state.reduceFlashing = (event.target as HTMLInputElement).checked;
    render();
  });

  el.mixtureMode.addEventListener("change", (event) => {
    state.mixtureMode = (event.target as HTMLInputElement).checked;
    render();
  });

  el.tabDigital.addEventListener("click", () => {
    el.tabDigital.classList.add("active");
    el.tabPaper.classList.remove("active");
    el.panelDigital.classList.add("active");
    el.panelPaper.classList.remove("active");
  });

  el.tabPaper.addEventListener("click", () => {
    el.tabPaper.classList.add("active");
    el.tabDigital.classList.remove("active");
    el.panelPaper.classList.add("active");
    el.panelDigital.classList.remove("active");
  });

  el.oxidizerPositive.addEventListener("change", (event) => {
    state.oxidizerPositive = (event.target as HTMLSelectElement).value as Observation;
    render();
  });

  el.waterFinding.addEventListener("change", (event) => {
    state.waterFinding = (event.target as HTMLSelectElement).value as Observation;
    render();
  });

  el.fluorideTest.addEventListener("change", (event) => {
    state.fluorideTest = (event.target as HTMLSelectElement).value as Observation;
    render();
  });

  el.m8Test.addEventListener("change", (event) => {
    state.m8Test = (event.target as HTMLSelectElement).value as Observation;
    render();
  });

  el.ph.addEventListener("change", (event) => {
    state.ph = (event.target as HTMLSelectElement).value as PhTendency;
    render();
  });

  el.ackBtn.addEventListener("click", () => {
    state.acknowledged = true;
    render();
  });

  render();
}

init();
