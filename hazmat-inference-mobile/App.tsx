import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { CHEMICAL_LIBRARY, computeAlarmState, renderAlarmState, triggerTypeLabel, updateCandidates } from "hazmat-core";
import type { EvidenceInput, PhTendency } from "hazmat-core";

const PH_OPTIONS: PhTendency[] = ["unknown", "acidic", "neutral", "basic"];

type NumericField = "pidPpm" | "fidPpm" | "o2Pct" | "lelPct" | "coPpm" | "h2sPpm";

function formatReading(value: number | null) {
  if (value == null || Number.isNaN(value)) return "--";
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function NumericInput(props: {
  label: string;
  field: NumericField;
  value: string;
  onChange: (field: NumericField, value: string) => void;
  onCommit: (field: NumericField) => void;
}) {
  const { label, field, value, onChange, onCommit } = props;

  return (
    <View style={styles.inputBlock}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={(next) => onChange(field, next)}
        onBlur={() => onCommit(field)}
        onSubmitEditing={() => onCommit(field)}
        keyboardType="decimal-pad"
        placeholder="Enter value"
        style={styles.input}
        returnKeyType="done"
      />
    </View>
  );
}

export default function App() {
  const [selectedChemicalId, setSelectedChemicalId] = useState<string>("");
  const [chemicalQuery, setChemicalQuery] = useState("");
  const [reduceFlashing, setReduceFlashing] = useState(false);
  const [mixtureMode, setMixtureMode] = useState(false);

  const [draft, setDraft] = useState<Record<NumericField, string>>({
    pidPpm: "",
    fidPpm: "",
    o2Pct: "",
    lelPct: "",
    coPpm: "",
    h2sPpm: "",
  });

  const [input, setInput] = useState<EvidenceInput>({
    pidPpm: null,
    fidPpm: null,
    o2Pct: null,
    lelPct: null,
    coPpm: null,
    h2sPpm: null,
    ph: "unknown",
    oxidizerPositive: false,
    mixtureMode: false,
  });

  const timers = useRef<Partial<Record<NumericField, ReturnType<typeof setTimeout>>>>({});

  const [alarmLatched, setAlarmLatched] = useState(false);
  const [alarmAcknowledged, setAlarmAcknowledged] = useState(false);
  const alarmAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceFlashing(enabled);
    });

    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
      setReduceFlashing(enabled);
    });

    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const timer of Object.values(timers.current)) {
        if (timer) clearTimeout(timer);
      }
    };
  }, []);

  useEffect(() => {
    setInput((prev) => ({ ...prev, mixtureMode }));
  }, [mixtureMode]);

  const scoredCandidates = useMemo(() => updateCandidates(input, CHEMICAL_LIBRARY), [input]);

  const alarmEval = useMemo(
    () =>
      computeAlarmState({
        readingValue: input.pidPpm,
        readingLabel: "PID ppm",
        o2Pct: input.o2Pct,
        lelPct: input.lelPct,
        candidates: scoredCandidates,
        selectedChemicalId: selectedChemicalId || null,
      }),
    [input.lelPct, input.o2Pct, input.pidPpm, scoredCandidates, selectedChemicalId],
  );

  useEffect(() => {
    if (alarmEval.triggerActive) {
      setAlarmLatched(true);
      setAlarmAcknowledged(false);
      return;
    }

    if (!alarmLatched) return;

    const canClear =
      alarmAcknowledged &&
      (alarmEval.clearThreshold == null ||
        alarmEval.readingValue == null ||
        alarmEval.readingValue < alarmEval.clearThreshold);

    if (canClear) {
      setAlarmLatched(false);
      setAlarmAcknowledged(false);
    }
  }, [alarmAcknowledged, alarmEval, alarmLatched]);

  useEffect(() => {
    if (!alarmLatched || reduceFlashing) {
      alarmAnim.stopAnimation();
      alarmAnim.setValue(1);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(alarmAnim, {
          toValue: 0,
          duration: 500,
          easing: Easing.linear,
          useNativeDriver: false,
        }),
        Animated.timing(alarmAnim, {
          toValue: 1,
          duration: 500,
          easing: Easing.linear,
          useNativeDriver: false,
        }),
      ]),
    );

    loop.start();
    return () => loop.stop();
  }, [alarmAnim, alarmLatched, reduceFlashing]);

  const alarmState = renderAlarmState({
    latched: alarmLatched,
    acknowledged: alarmAcknowledged,
    selectedChemicalId: selectedChemicalId || null,
  });

  const borderColor = alarmAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["#7f1d1d", "#ef4444"],
  });

  const topCandidates = scoredCandidates.filter((c) => !c.eliminated).slice(0, 6);
  const eliminated = scoredCandidates.filter((c) => c.eliminated);
  const filteredChemicals = useMemo(() => {
    const query = chemicalQuery.trim().toLowerCase();
    if (!query) return CHEMICAL_LIBRARY.slice(0, 24);
    return CHEMICAL_LIBRARY.filter((chemical) => chemical.name.toLowerCase().includes(query)).slice(0, 24);
  }, [chemicalQuery]);

  function commitField(field: NumericField) {
    setInput((prev) => {
      const raw = draft[field];
      const parsed = raw.trim() === "" ? null : Number(raw);
      return {
        ...prev,
        [field]: parsed != null && Number.isFinite(parsed) ? parsed : null,
      };
    });
  }

  function scheduleCommit(field: NumericField, value: string) {
    setDraft((prev) => ({ ...prev, [field]: value }));
    const existing = timers.current[field];
    if (existing) clearTimeout(existing);
    timers.current[field] = setTimeout(() => commitField(field), 1000);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <Animated.View
        style={[
          styles.screen,
          alarmLatched ? { borderColor, borderWidth: 8 } : { borderColor: "transparent", borderWidth: 8 },
          alarmLatched && reduceFlashing ? { borderColor: "#b91c1c" } : null,
        ]}
      >
        <ScrollView contentContainerStyle={styles.scroll}>
          {alarmLatched ? (
            <View style={styles.banner}>
              <Text style={styles.bannerTitle}>{triggerTypeLabel(alarmEval.triggerType)}</Text>
              <Text style={styles.bannerText}>
                Reading: {formatReading(alarmEval.readingValue)} {alarmEval.readingLabel}
                {alarmEval.threshold != null ? ` / Threshold: ${formatReading(alarmEval.threshold)}` : ""}
              </Text>
              <Text style={styles.bannerText}>
                {alarmEval.potential ? "POTENTIAL IDLH" : "CONFIRMED"} • {alarmEval.sourceLabel}
              </Text>
              <Text style={styles.bannerText}>State: {alarmState}</Text>
              <Pressable
                style={[styles.ackButton, alarmAcknowledged && styles.ackButtonDisabled]}
                onPress={() => setAlarmAcknowledged(true)}
                disabled={alarmAcknowledged}
              >
                <Text style={styles.ackButtonLabel}>{alarmAcknowledged ? "Acknowledged" : "Acknowledge"}</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.header}>Hazmat Inference Console</Text>

            <Text style={styles.label}>Chemical (optional, confirm when known)</Text>
            <TextInput
              value={chemicalQuery}
              onChangeText={setChemicalQuery}
              placeholder="Search chemical name..."
              style={styles.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.helperText}>
              Showing {filteredChemicals.length} of {CHEMICAL_LIBRARY.length} chemicals
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chemScroll}>
              <Pressable
                onPress={() => setSelectedChemicalId("")}
                style={[styles.chip, selectedChemicalId === "" && styles.chipActive]}
              >
                <Text style={[styles.chipText, selectedChemicalId === "" && styles.chipTextActive]}>Unknown</Text>
              </Pressable>
              {filteredChemicals.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => setSelectedChemicalId(c.id)}
                  style={[styles.chip, selectedChemicalId === c.id && styles.chipActive]}
                >
                  <Text style={[styles.chipText, selectedChemicalId === c.id && styles.chipTextActive]}>
                    {c.name} ({c.idlhPpm >= 1000000 ? "IDLH n/a" : c.idlhPpm})
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Reduce flashing</Text>
              <Switch value={reduceFlashing} onValueChange={setReduceFlashing} />
            </View>
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Mixture/contamination mode</Text>
              <Switch value={mixtureMode} onValueChange={setMixtureMode} />
            </View>
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Oxidizer paper positive</Text>
              <Switch
                value={input.oxidizerPositive}
                onValueChange={(value) => setInput((prev) => ({ ...prev, oxidizerPositive: value }))}
              />
            </View>

            <View style={styles.phRow}>
              {PH_OPTIONS.map((opt) => (
                <Pressable
                  key={opt}
                  onPress={() => setInput((prev) => ({ ...prev, ph: opt }))}
                  style={[styles.phChip, input.ph === opt && styles.phChipActive]}
                >
                  <Text style={[styles.phChipText, input.ph === opt && styles.phChipTextActive]}>{opt}</Text>
                </Pressable>
              ))}
            </View>

            <NumericInput label="PID ppm" field="pidPpm" value={draft.pidPpm} onChange={scheduleCommit} onCommit={commitField} />
            <NumericInput label="FID ppm" field="fidPpm" value={draft.fidPpm} onChange={scheduleCommit} onCommit={commitField} />
            <NumericInput label="O2 %" field="o2Pct" value={draft.o2Pct} onChange={scheduleCommit} onCommit={commitField} />
            <NumericInput label="LEL %" field="lelPct" value={draft.lelPct} onChange={scheduleCommit} onCommit={commitField} />
            <NumericInput label="CO ppm" field="coPpm" value={draft.coPpm} onChange={scheduleCommit} onCommit={commitField} />
            <NumericInput label="H2S ppm" field="h2sPpm" value={draft.h2sPpm} onChange={scheduleCommit} onCommit={commitField} />
          </View>

          <View style={styles.card}>
            <Text style={styles.header}>Match Confidence (based on entered data)</Text>
            {topCandidates.map((candidate) => (
              <View key={candidate.chemical.id} style={styles.candidateItem}>
                <View style={styles.candidateTopRow}>
                  <Text style={styles.candidateName}>{candidate.chemical.name}</Text>
                  <Text style={styles.candidateScore}>{candidate.confidence}%</Text>
                </View>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${candidate.confidence}%` }]} />
                </View>
                {candidate.supportReasons.slice(0, 3).map((reason) => (
                  <Text key={`${candidate.chemical.id}-s-${reason}`} style={styles.reasonGood}>
                    + {reason}
                  </Text>
                ))}
                {candidate.conflictReasons.slice(0, 2).map((reason) => (
                  <Text key={`${candidate.chemical.id}-c-${reason}`} style={styles.reasonBad}>
                    - {reason}
                  </Text>
                ))}
              </View>
            ))}

            <Text style={styles.subHeader}>Eliminated ({eliminated.length})</Text>
            {eliminated.map((candidate) => (
              <Text key={`elim-${candidate.chemical.id}`} style={styles.elimText}>
                {candidate.chemical.name}: {candidate.exclusionReasons[0] || "Lower-fit score after evidence updates."}
              </Text>
            ))}
          </View>
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#eef2f8",
  },
  screen: {
    flex: 1,
    backgroundColor: "#f6f8fc",
  },
  scroll: {
    padding: 12,
    gap: 12,
  },
  banner: {
    backgroundColor: "#b91c1c",
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  bannerTitle: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "800",
  },
  bannerText: {
    color: "#fee2e2",
    fontSize: 13,
    fontWeight: "600",
  },
  ackButton: {
    marginTop: 6,
    alignSelf: "flex-start",
    backgroundColor: "#fff1f2",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  ackButtonDisabled: {
    opacity: 0.6,
  },
  ackButtonLabel: {
    color: "#991b1b",
    fontWeight: "800",
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#dce4f0",
    padding: 12,
    gap: 8,
  },
  header: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0f172a",
  },
  label: {
    fontSize: 13,
    color: "#334155",
    fontWeight: "700",
  },
  searchInput: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 14,
    color: "#0f172a",
  },
  helperText: {
    fontSize: 12,
    color: "#64748b",
    marginTop: -2,
  },
  chemScroll: {
    marginBottom: 4,
  },
  chip: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
  },
  chipActive: {
    backgroundColor: "#0f766e",
    borderColor: "#0f766e",
  },
  chipText: {
    color: "#0f172a",
    fontSize: 12,
    fontWeight: "600",
  },
  chipTextActive: {
    color: "#fff",
  },
  toggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  toggleLabel: {
    color: "#1e293b",
    fontSize: 14,
    fontWeight: "600",
  },
  phRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 2,
    marginBottom: 6,
  },
  phChip: {
    borderWidth: 1,
    borderColor: "#bfdbfe",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  phChipActive: {
    backgroundColor: "#1d4ed8",
    borderColor: "#1d4ed8",
  },
  phChipText: {
    color: "#1e3a8a",
    fontWeight: "700",
    fontSize: 12,
  },
  phChipTextActive: {
    color: "#fff",
  },
  inputBlock: {
    gap: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 15,
    color: "#0f172a",
  },
  candidateItem: {
    borderWidth: 1,
    borderColor: "#dbe3ef",
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  candidateTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  candidateName: {
    fontWeight: "800",
    color: "#0f172a",
    fontSize: 14,
    flex: 1,
    paddingRight: 8,
  },
  candidateScore: {
    fontWeight: "800",
    color: "#0f766e",
  },
  barTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: "#e2e8f0",
    overflow: "hidden",
    marginTop: 2,
    marginBottom: 2,
  },
  barFill: {
    height: "100%",
    backgroundColor: "#0891b2",
  },
  reasonGood: {
    fontSize: 12,
    color: "#0f766e",
  },
  reasonBad: {
    fontSize: 12,
    color: "#b91c1c",
  },
  subHeader: {
    marginTop: 8,
    fontWeight: "800",
    color: "#0f172a",
    fontSize: 14,
  },
  elimText: {
    fontSize: 12,
    color: "#334155",
  },
});
