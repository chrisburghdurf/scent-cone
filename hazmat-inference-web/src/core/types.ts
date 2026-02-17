export type InstrumentClass = "none" | "low" | "medium" | "high";

export type PhTendency = "acidic" | "neutral" | "basic" | "unknown";

export type AlarmState = "NORMAL" | "POTENTIAL_IDLH_ALARM" | "CONFIRMED_IDLH_ALARM" | "ACKNOWLEDGED";

export type TriggerType = "idlh" | "o2" | "lel";

export interface ChemicalRecord {
  id: string;
  name: string;
  synonyms: string[];
  unNa?: string;
  ergGuide?: string;
  idlhPpm: number;
  npgPage: string;
  flags: {
    strongBase?: boolean;
    hydrocarbon?: boolean;
    oxygenatedVoc?: boolean;
    canDisplaceOxygen?: boolean;
    flammable?: boolean;
    oxidizer?: boolean;
    corrosive?: boolean;
  };
  expected: {
    pid: InstrumentClass;
    fid: InstrumentClass;
    ph: PhTendency;
    oxidizerPositive?: boolean;
    lelBehavior?: "none" | "possible" | "strong";
  };
}

export interface EvidenceInput {
  pidPpm: number | null;
  fidPpm: number | null;
  o2Pct: number | null;
  lelPct: number | null;
  coPpm: number | null;
  h2sPpm: number | null;
  ph: PhTendency;
  oxidizerPositive: boolean;
  mixtureMode: boolean;
}

export interface CandidateScore {
  chemical: ChemicalRecord;
  score: number;
  confidence: number;
  excluded: boolean;
  supportReasons: string[];
  conflictReasons: string[];
  exclusionReasons: string[];
  eliminated: boolean;
}

export interface AlarmEvaluation {
  triggerActive: boolean;
  triggerType: TriggerType | null;
  potential: boolean;
  threshold: number | null;
  clearThreshold: number | null;
  readingValue: number | null;
  readingLabel: string;
  sourceChemicalIds: string[];
  sourceLabel: string;
}
