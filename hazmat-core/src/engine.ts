import { AlarmEvaluation, CandidateScore, ChemicalRecord, EvidenceInput, InstrumentClass, TriggerType } from "./types";

function classifyPpm(value: number | null): InstrumentClass {
  if (value == null) return "none";
  if (value < 2) return "none";
  if (value < 20) return "low";
  if (value < 100) return "medium";
  return "high";
}

function classScore(observed: InstrumentClass, expected: InstrumentClass, weight: number) {
  if (expected === "unknown") return { delta: 0, support: "", conflict: "" };
  if (observed === "none") return { delta: 0, support: "", conflict: "" };
  if (observed === expected) {
    return { delta: weight, support: `Observed ${observed.toUpperCase()} matches expected ${expected.toUpperCase()}.`, conflict: "" };
  }

  const closeMatch =
    (observed === "medium" && (expected === "low" || expected === "high")) ||
    (expected === "medium" && (observed === "low" || observed === "high"));

  if (closeMatch) {
    return {
      delta: Math.round(weight * 0.35),
      support: `Observed ${observed.toUpperCase()} is close to expected ${expected.toUpperCase()}.`,
      conflict: "",
    };
  }

  return {
    delta: -Math.round(weight * 0.75),
    support: "",
    conflict: `Observed ${observed.toUpperCase()} conflicts with expected ${expected.toUpperCase()}.`,
  };
}

function hardExclusions(input: EvidenceInput, chemical: ChemicalRecord): string[] {
  const reasons: string[] = [];

  if (!input.mixtureMode && input.ph === "acidic" && chemical.flags.strongBase) {
    reasons.push("Strongly acidic pH conflicts with strong-base behavior.");
  }

  if (!input.mixtureMode && input.oxidizerPositive && chemical.flags.hydrocarbon && !chemical.flags.oxidizer) {
    reasons.push("Oxidizer paper positive conflicts with pure hydrocarbon profile.");
  }

  if (!input.mixtureMode && (input.fidPpm ?? 0) >= 50 && (input.pidPpm ?? 0) < 2 && chemical.flags.oxygenatedVoc) {
    reasons.push("FID high with PID near zero conflicts with oxygenated VOC signature.");
  }

  if (!input.mixtureMode && (input.o2Pct ?? 20.9) <= 19.5 && chemical.flags.canDisplaceOxygen === false) {
    reasons.push("O2 depletion conflicts with non-displacing gas profile.");
  }

  return reasons;
}

export function updateCandidates(input: EvidenceInput, candidates: ChemicalRecord[]): CandidateScore[] {
  const evaluated = candidates.map((chemical) => {
    let score = 20;
    const supportReasons: string[] = [];
    const conflictReasons: string[] = [];

    const exclusionReasons = hardExclusions(input, chemical);
    const excluded = exclusionReasons.length > 0;

    const pid = classScore(classifyPpm(input.pidPpm), chemical.expected.pid, 18);
    score += pid.delta;
    if (pid.support) supportReasons.push(`PID supports: ${pid.support}`);
    if (pid.conflict) conflictReasons.push(`PID conflicts: ${pid.conflict}`);

    const fid = classScore(classifyPpm(input.fidPpm), chemical.expected.fid, 16);
    score += fid.delta;
    if (fid.support) supportReasons.push(`FID supports: ${fid.support}`);
    if (fid.conflict) conflictReasons.push(`FID conflicts: ${fid.conflict}`);

    if (input.ph !== "unknown") {
      if (chemical.expected.ph === "unknown") {
        // No pH expectation available for this record.
      } else if (input.ph === chemical.expected.ph) {
        score += 14;
        supportReasons.push(`pH supports expected ${chemical.expected.ph} tendency.`);
      } else {
        score -= 10;
        conflictReasons.push(`pH conflicts with expected ${chemical.expected.ph} tendency.`);
      }
    }

    if (input.oxidizerPositive) {
      if (chemical.expected.oxidizerPositive || chemical.flags.oxidizer) {
        score += 14;
        supportReasons.push("Oxidizer paper positive matches oxidizer behavior.");
      } else if (chemical.expected.oxidizerPositive === false || chemical.flags.oxidizer === false) {
        score -= 8;
        conflictReasons.push("Oxidizer paper positive conflicts with non-oxidizer profile.");
      }
    }

    if (input.lelPct != null) {
      if (input.lelPct >= 10 && chemical.flags.flammable) {
        score += 12;
        supportReasons.push("LEL reading supports flammable profile.");
      }
      if (input.lelPct >= 10 && chemical.flags.flammable === false) {
        score -= 12;
        conflictReasons.push("LEL reading conflicts with non-flammable profile.");
      }
      if (input.lelPct < 1 && chemical.expected.lelBehavior === "strong") {
        score -= 6;
        conflictReasons.push("Low LEL conflicts with expected flammability behavior.");
      }
    }

    if ((input.o2Pct ?? 20.9) <= 19.5 && chemical.flags.canDisplaceOxygen) {
      score += 10;
      supportReasons.push("Low O2 supports displacement/asphyxiant behavior.");
    }

    if ((input.coPpm ?? 0) > 35 && chemical.name !== "Carbon Dioxide") {
      score -= 3;
      conflictReasons.push("Elevated CO may indicate combustion/mixed-source conditions.");
    }

    if ((input.h2sPpm ?? 0) > 10 && chemical.name !== "Carbon Dioxide") {
      score -= 3;
      conflictReasons.push("Elevated H2S may indicate sulfur-bearing mixed-source conditions.");
    }

    return {
      chemical,
      score: excluded ? -999 : score,
      confidence: 0,
      excluded,
      supportReasons,
      conflictReasons,
      exclusionReasons,
      eliminated: excluded,
    };
  });

  const survivors = evaluated.filter((c) => !c.excluded);
  const maxScore = survivors.length ? Math.max(...survivors.map((c) => c.score)) : 0;
  const minScore = survivors.length ? Math.min(...survivors.map((c) => c.score)) : 0;
  const cutoff = maxScore - 14;

  return evaluated
    .map((candidate) => {
      if (candidate.excluded) return { ...candidate, confidence: 0, eliminated: true };

      const spread = Math.max(1, maxScore - minScore);
      const normalized = Math.max(0, Math.min(1, (candidate.score - minScore) / spread));
      const confidence = Math.round(20 + normalized * 79);

      return {
        ...candidate,
        confidence,
        eliminated: candidate.score < cutoff,
      };
    })
    .sort((a, b) => {
      if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
      return b.score - a.score;
    });
}

export function computeAlarmState(args: {
  readingValue: number | null;
  readingLabel: string;
  o2Pct: number | null;
  lelPct: number | null;
  candidates: CandidateScore[];
  selectedChemicalId: string | null;
}): AlarmEvaluation {
  const { readingValue, readingLabel, o2Pct, lelPct, candidates, selectedChemicalId } = args;

  if (o2Pct != null && (o2Pct < 19.5 || o2Pct > 23.5)) {
    const low = o2Pct < 19.5;
    return {
      triggerActive: true,
      triggerType: "o2",
      potential: false,
      threshold: low ? 19.5 : 23.5,
      clearThreshold: low ? 19.8 : 23.2,
      readingValue: o2Pct,
      readingLabel: "O2 %",
      sourceChemicalIds: [],
      sourceLabel: "QRAE O2 safety range",
    };
  }

  if (lelPct != null && lelPct >= 20) {
    return {
      triggerActive: true,
      triggerType: "lel",
      potential: false,
      threshold: 20,
      clearThreshold: 15,
      readingValue: lelPct,
      readingLabel: "LEL %",
      sourceChemicalIds: [],
      sourceLabel: "QRAE LEL critical threshold",
    };
  }

  const active = candidates.filter((c) => !c.eliminated && !c.excluded).slice(0, 4);

  if (!active.length || readingValue == null) {
    return {
      triggerActive: false,
      triggerType: null,
      potential: false,
      threshold: null,
      clearThreshold: null,
      readingValue,
      readingLabel,
      sourceChemicalIds: [],
      sourceLabel: "",
    };
  }

  if (selectedChemicalId) {
    const selected = candidates.find((c) => c.chemical.id === selectedChemicalId);
    if (!selected) {
      return {
        triggerActive: false,
        triggerType: null,
        potential: false,
        threshold: null,
        clearThreshold: null,
        readingValue,
        readingLabel,
        sourceChemicalIds: [],
        sourceLabel: "",
      };
    }

    const threshold = selected.chemical.idlhPpm;
    return {
      triggerActive: readingValue >= threshold,
      triggerType: "idlh",
      potential: false,
      threshold,
      clearThreshold: threshold * 0.9,
      readingValue,
      readingLabel,
      sourceChemicalIds: [selected.chemical.id],
      sourceLabel: `${selected.chemical.name} (NIOSH NPG p.${selected.chemical.npgPage})`,
    };
  }

  const threshold = Math.min(...active.map((c) => c.chemical.idlhPpm));
  const driving = active.filter((c) => c.chemical.idlhPpm === threshold).map((c) => c.chemical.id);

  return {
    triggerActive: readingValue >= threshold,
    triggerType: "idlh",
    potential: true,
    threshold,
    clearThreshold: threshold * 0.9,
    readingValue,
    readingLabel,
    sourceChemicalIds: driving,
    sourceLabel: `Lowest candidate IDLH: ${threshold} ppm`,
  };
}

export function renderAlarmState(args: {
  latched: boolean;
  acknowledged: boolean;
  selectedChemicalId: string | null;
}) {
  if (!args.latched) return "NORMAL";
  if (args.acknowledged) return "ACKNOWLEDGED";
  return args.selectedChemicalId ? "CONFIRMED_IDLH_ALARM" : "POTENTIAL_IDLH_ALARM";
}

export function triggerTypeLabel(triggerType: TriggerType | null) {
  if (triggerType === "o2") return "LIFE HAZARD (O2 RANGE)";
  if (triggerType === "lel") return "LIFE HAZARD (LEL)";
  return "IDLH THRESHOLD EXCEEDED";
}
