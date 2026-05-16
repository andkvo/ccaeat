import * as Speech from 'expo-speech';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

type TimerMode = 'prep' | 'speech';

type Cue = {
  id: string;
  atSeconds: number;
  message: string;
  visual?: string;
};

const PREP_DURATION_SECONDS = 5 * 60;
const FLASH_COUNT = 10;
const FLASH_ON_MS = 120;
const FLASH_OFF_MS = 120;
const FLASH_START_DELAY_MS = 16;

const PREP_CUES: Cue[] = [
  { id: 'prep-4m', atSeconds: 240, message: '4 minutes.' },
  { id: 'prep-3m', atSeconds: 180, message: '3 minutes.' },
  { id: 'prep-2m', atSeconds: 120, message: '2 minutes.' },
  { id: 'prep-1m', atSeconds: 60, message: '1 minute.' },
  { id: 'prep-30s', atSeconds: 30, message: '30 seconds.' },
  { id: 'prep-5s', atSeconds: 5, message: '5-4-3-2-1 Time.' },
];

const SPEECH_CUES: Cue[] = [
  { id: 'speech-1m', atSeconds: 60, message: 'Hold up 4 fingers.', visual: '4' },
  { id: 'speech-2m', atSeconds: 120, message: 'Hold up 3 fingers.', visual: '3' },
  { id: 'speech-3m', atSeconds: 180, message: 'Hold up 2 fingers.', visual: '2' },
  { id: 'speech-4m', atSeconds: 240, message: 'Hold up 1 finger.', visual: '1' },
  { id: 'speech-430', atSeconds: 270, message: 'Show 30 seconds remaining.', visual: '30' },
  {
    id: 'speech-455',
    atSeconds: 295,
    message: 'Show 5-4-3-2-1 finger countdown.',
    visual: '5-4-3-2-1',
  },
];

const formatFromSeconds = (totalSeconds: number): string => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export default function App() {
  const [mode, setMode] = useState<TimerMode>('prep');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [running, setRunning] = useState(false);
  const [currentCue, setCurrentCue] = useState('Ready.');
  const [cueLog, setCueLog] = useState<string[]>([]);
  const [reportedSpeechTime, setReportedSpeechTime] = useState<string | null>(null);
  const [visualSignal, setVisualSignal] = useState('READY');
  const [flashVisible, setFlashVisible] = useState(false);

  const firedCuesRef = useRef(new Set<string>());
  const previousElapsedMsRef = useRef(0);
  const tickTimestampRef = useRef<number | null>(null);
  const flashTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const displaySeconds = useMemo(() => {
    if (mode === 'prep') {
      const remaining = Math.max(0, PREP_DURATION_SECONDS - elapsedMs / 1000);
      return Math.ceil(remaining);
    }

    return Math.floor(elapsedMs / 1000);
  }, [elapsedMs, mode]);

  const clearFlashTimeout = () => {
    flashTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
    flashTimeoutsRef.current = [];
  };

  const triggerFlash = () => {
    clearFlashTimeout();
    setFlashVisible(false);

    for (let flashIndex = 0; flashIndex < FLASH_COUNT; flashIndex += 1) {
      const cycleStart = FLASH_START_DELAY_MS + flashIndex * (FLASH_ON_MS + FLASH_OFF_MS);
      const showTimeout = setTimeout(() => {
        setFlashVisible(true);
      }, cycleStart);
      const hideTimeout = setTimeout(() => {
        setFlashVisible(false);
      }, cycleStart + FLASH_ON_MS);

      flashTimeoutsRef.current.push(showTimeout, hideTimeout);
    }
  };

  const resetTimer = () => {
    setRunning(false);
    setElapsedMs(0);
    setCurrentCue('Ready.');
    setCueLog([]);
    setReportedSpeechTime(null);
    setVisualSignal('READY');
    setFlashVisible(false);
    clearFlashTimeout();
    Speech.stop();
    firedCuesRef.current.clear();
    previousElapsedMsRef.current = 0;
    tickTimestampRef.current = null;
  };

  const switchMode = (nextMode: TimerMode) => {
    if (nextMode === mode) {
      return;
    }

    setMode(nextMode);
    resetTimer();
  };

  const addCue = (cue: Cue, cueMode: TimerMode) => {
    firedCuesRef.current.add(cue.id);
    setCurrentCue(cue.message);
    setCueLog((previous) => [cue.message, ...previous].slice(0, 6));

    if (cueMode === 'prep') {
      Speech.speak(cue.message, {
        language: 'en-US',
        rate: 0.95,
        pitch: 1,
      });
      return;
    }

    setVisualSignal(cue.visual ?? cue.message);
    triggerFlash();
  };

  useEffect(() => {
    if (!running) {
      tickTimestampRef.current = null;
      return;
    }

    const interval = setInterval(() => {
      const now = Date.now();
      const last = tickTimestampRef.current ?? now;
      const delta = now - last;
      tickTimestampRef.current = now;

      setElapsedMs((previous) => {
        const next = previous + delta;

        if (mode === 'prep') {
          return Math.min(next, PREP_DURATION_SECONDS * 1000);
        }

        return next;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [mode, running]);

  useEffect(() => {
    if (mode === 'prep' && elapsedMs >= PREP_DURATION_SECONDS * 1000 && running) {
      setRunning(false);
      setCurrentCue('Prep time complete.');
    }
  }, [elapsedMs, mode, running]);

  useEffect(() => {
    const previousElapsed = previousElapsedMsRef.current;
    const currentElapsed = elapsedMs;

    if (mode === 'prep') {
      const previousRemainingSeconds = Math.max(0, PREP_DURATION_SECONDS - previousElapsed / 1000);
      const currentRemainingSeconds = Math.max(0, PREP_DURATION_SECONDS - currentElapsed / 1000);

      PREP_CUES.forEach((cue) => {
        if (firedCuesRef.current.has(cue.id)) {
          return;
        }

        if (previousRemainingSeconds > cue.atSeconds && currentRemainingSeconds <= cue.atSeconds) {
          addCue(cue, 'prep');
        }
      });
    } else {
      const previousSeconds = previousElapsed / 1000;
      const currentSeconds = currentElapsed / 1000;

      SPEECH_CUES.forEach((cue) => {
        if (firedCuesRef.current.has(cue.id)) {
          return;
        }

        if (previousSeconds < cue.atSeconds && currentSeconds >= cue.atSeconds) {
          addCue(cue, 'speech');
        }
      });
    }

    previousElapsedMsRef.current = elapsedMs;
  }, [elapsedMs, mode]);

  useEffect(() => {
    return () => {
      clearFlashTimeout();
      Speech.stop();
    };
  }, []);

  const toggleRunState = () => {
    if (!running && mode === 'prep' && elapsedMs >= PREP_DURATION_SECONDS * 1000) {
      resetTimer();
    }

    if (running && mode === 'speech') {
      setReportedSpeechTime(formatFromSeconds(Math.floor(elapsedMs / 1000)));
    }

    setRunning((previous) => !previous);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      {flashVisible ? <View pointerEvents="none" style={styles.flashOverlay} /> : null}
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>CCA EA Timer</Text>

        <View style={styles.modeRow}>
          <Pressable
            accessibilityRole="button"
            style={[styles.modeButton, mode === 'prep' && styles.modeButtonActive]}
            onPress={() => switchMode('prep')}
          >
            <Text style={[styles.modeButtonText, mode === 'prep' && styles.modeButtonTextActive]}>Prep</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={[styles.modeButton, mode === 'speech' && styles.modeButtonActive]}
            onPress={() => switchMode('speech')}
          >
            <Text style={[styles.modeButtonText, mode === 'speech' && styles.modeButtonTextActive]}>Speaking</Text>
          </Pressable>
        </View>

        <Text style={styles.modeDescription}>
          {mode === 'prep'
            ? 'Spoken prep signals • Count Down from 5:00'
            : 'Silent speaking signals • Count Up from 0:00'}
        </Text>

        <Text style={styles.timer}>{formatFromSeconds(displaySeconds)}</Text>

        {mode === 'speech' ? (
          <View style={styles.visualSignalCard}>
            <Text style={styles.visualSignalLabel}>Silent Visual Signal (Minutes Remaining)</Text>
            <Text style={styles.visualSignalValue}>{visualSignal}</Text>
          </View>
        ) : null}

        <View style={styles.controlsRow}>
          <Pressable style={[styles.controlButton, styles.primaryButton]} onPress={toggleRunState}>
            <Text style={styles.controlText}>{running ? 'Pause' : 'Start'}</Text>
          </Pressable>
          <Pressable style={[styles.controlButton, styles.secondaryButton]} onPress={resetTimer}>
            <Text style={[styles.controlText, styles.secondaryText]}>Reset</Text>
          </Pressable>
        </View>

        {reportedSpeechTime ? (
          <Text style={styles.reportText}>Report to judges: {reportedSpeechTime}</Text>
        ) : null}

        <View style={styles.cueCard}>
          <Text style={styles.cueLabel}>Current Signal</Text>
          <Text style={styles.cueText}>{currentCue}</Text>
        </View>

        <View style={styles.logCard}>
          <Text style={styles.logLabel}>Recent Signals</Text>
          {cueLog.length === 0 ? (
            <Text style={styles.logItem}>No signals yet.</Text>
          ) : (
            cueLog.map((entry, index) => (
              <Text key={`${entry}-${index}`} style={styles.logItem}>
                • {entry}
              </Text>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  flashOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(248, 250, 252, 0.35)',
    zIndex: 3,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingVertical: 24,
    gap: 14,
  },
  title: {
    color: '#f8fafc',
    fontSize: 30,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modeButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#1e293b',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modeButtonActive: {
    borderColor: '#60a5fa',
    backgroundColor: '#1d4ed8',
  },
  modeButtonText: {
    color: '#cbd5e1',
    fontSize: 16,
    fontWeight: '600',
  },
  modeButtonTextActive: {
    color: '#f8fafc',
  },
  modeDescription: {
    color: '#cbd5e1',
    fontSize: 16,
    textAlign: 'center',
  },
  timer: {
    color: '#f8fafc',
    fontSize: 68,
    fontWeight: '700',
    textAlign: 'center',
    marginVertical: 8,
  },
  visualSignalCard: {
    borderRadius: 16,
    borderColor: '#f8fafc',
    borderWidth: 2,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: '#1e293b',
    gap: 4,
  },
  visualSignalLabel: {
    color: '#93c5fd',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontSize: 13,
  },
  visualSignalValue: {
    color: '#f8fafc',
    fontWeight: '800',
    fontSize: 60,
    lineHeight: 68,
  },
  controlsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  controlButton: {
    flex: 1,
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 13,
  },
  primaryButton: {
    backgroundColor: '#22c55e',
  },
  secondaryButton: {
    backgroundColor: '#f8fafc',
  },
  controlText: {
    fontWeight: '700',
    fontSize: 16,
    color: '#0f172a',
  },
  secondaryText: {
    color: '#0f172a',
  },
  reportText: {
    color: '#86efac',
    fontWeight: '600',
    textAlign: 'center',
    fontSize: 16,
  },
  cueCard: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 6,
  },
  cueLabel: {
    color: '#93c5fd',
    fontWeight: '600',
    fontSize: 14,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  cueText: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '600',
  },
  logCard: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 6,
  },
  logLabel: {
    color: '#93c5fd',
    fontWeight: '600',
    fontSize: 14,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  logItem: {
    color: '#e2e8f0',
    fontSize: 16,
    lineHeight: 22,
  },
});
