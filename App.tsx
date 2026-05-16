import { Audio } from 'expo-av';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

type TimerMode = 'prep' | 'speech';

type Cue = {
  id: string;
  atSeconds: number;
  message: string;
  visual?: string;
};

const PREP_DURATION_SECONDS = 5 * 60;
const FLASH_COUNT = 10;
const TOGGLES_PER_COMPLETE_FLASH = 2;
const FLASH_INTERVAL_MS = 120;
const FLASH_START_DELAY_MS = 16;

const PREP_CUES: Cue[] = [
  { id: 'prep-4m', atSeconds: 240, message: '4 minutes.', visual: '4' },
  { id: 'prep-3m', atSeconds: 180, message: '3 minutes.', visual: '3' },
  { id: 'prep-2m', atSeconds: 120, message: '2 minutes.', visual: '2' },
  { id: 'prep-1m', atSeconds: 60, message: '1 minute.', visual: '1' },
  { id: 'prep-30s', atSeconds: 30, message: '30 seconds.', visual: '30s' },
  { id: 'prep-5s', atSeconds: 5, message: '5-4-3-2-1 Time.' },
];

const SPEECH_CUES: Cue[] = [
  { id: 'speech-1m', atSeconds: 60, message: 'Hold up 4 fingers.', visual: '4' },
  { id: 'speech-2m', atSeconds: 120, message: 'Hold up 3 fingers.', visual: '3' },
  { id: 'speech-3m', atSeconds: 180, message: 'Hold up 2 fingers.', visual: '2' },
  { id: 'speech-4m', atSeconds: 240, message: 'Hold up 1 finger.', visual: '1' },
  { id: 'speech-430', atSeconds: 270, message: 'Show 30 seconds remaining.', visual: '30s' },
  { id: 'speech-455', atSeconds: 295, message: 'Show 5-4-3-2-1 finger countdown.' },
];

const PREP_AUDIO: Record<string, number> = {
  'prep-4m': require('./assets/audio/prep-4m.mp3'),
  'prep-3m': require('./assets/audio/prep-3m.mp3'),
  'prep-2m': require('./assets/audio/prep-2m.mp3'),
  'prep-1m': require('./assets/audio/prep-1m.mp3'),
  'prep-30s': require('./assets/audio/prep-30s.mp3'),
  'prep-5s': require('./assets/audio/prep-5s.mp3'),
};

const formatFromSeconds = (totalSeconds: number): string => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export default function App() {
  const [mode, setMode] = useState<TimerMode>('prep');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [running, setRunning] = useState(false);
  const [reportedSpeechTime, setReportedSpeechTime] = useState<string | null>(null);
  const [visualSignal, setVisualSignal] = useState('READY');
  const [flashVisible, setFlashVisible] = useState(false);
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const firedCuesRef = useRef(new Set<string>());
  const previousElapsedMsRef = useRef(0);
  const tickTimestampRef = useRef<number | null>(null);
  const flashStartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const flashSequenceRef = useRef(0);
  const flashTogglesRemainingRef = useRef(0);
  const countdownTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const activeSoundRef = useRef<Audio.Sound | null>(null);

  const displaySeconds = useMemo(() => {
    if (mode === 'prep') {
      const remaining = Math.max(0, PREP_DURATION_SECONDS - elapsedMs / 1000);
      return Math.ceil(remaining);
    }

    return Math.floor(elapsedMs / 1000);
  }, [elapsedMs, mode]);

  const clearFlashTimeout = () => {
    flashSequenceRef.current += 1;

    if (flashStartTimeoutRef.current) {
      clearTimeout(flashStartTimeoutRef.current);
      flashStartTimeoutRef.current = null;
    }

    if (flashIntervalRef.current) {
      clearInterval(flashIntervalRef.current);
      flashIntervalRef.current = null;
    }
  };

  const clearCountdownTimeouts = () => {
    countdownTimeoutsRef.current.forEach(clearTimeout);
    countdownTimeoutsRef.current = [];
  };

  const triggerFlash = () => {
    clearFlashTimeout();
    setFlashVisible(false);
    const sequenceId = flashSequenceRef.current;
    flashTogglesRemainingRef.current = FLASH_COUNT * TOGGLES_PER_COMPLETE_FLASH;

    flashStartTimeoutRef.current = setTimeout(() => {
      if (flashSequenceRef.current !== sequenceId) {
        return;
      }

      setFlashVisible(true);
      flashTogglesRemainingRef.current -= 1;
      flashStartTimeoutRef.current = null;

      flashIntervalRef.current = setInterval(() => {
        if (flashSequenceRef.current !== sequenceId) {
          clearFlashTimeout();
          return;
        }

        setFlashVisible((previous) => !previous);
        flashTogglesRemainingRef.current -= 1;

        if (flashTogglesRemainingRef.current <= 0) {
          clearFlashTimeout();
          setFlashVisible(false);
        }
      }, FLASH_INTERVAL_MS);
    }, FLASH_START_DELAY_MS);
  };

  const stopSound = async () => {
    const sound = activeSoundRef.current;
    activeSoundRef.current = null;
    await sound?.unloadAsync();
  };

  const playSound = async (cueId: string) => {
    const source = PREP_AUDIO[cueId];
    if (source == null) return;
    await stopSound();
    try {
      const { sound } = await Audio.Sound.createAsync(source);
      activeSoundRef.current = sound;
      await sound.playAsync();
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync();
          if (activeSoundRef.current === sound) activeSoundRef.current = null;
        }
      });
    } catch {}
  };

  const resetTimer = () => {
    setRunning(false);
    setElapsedMs(0);
    setReportedSpeechTime(null);
    setVisualSignal('READY');
    setFlashVisible(false);
    clearFlashTimeout();
    clearCountdownTimeouts();
    stopSound();
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

    const isCountdown = cue.id === 'prep-5s' || cue.id === 'speech-455';

    if (isCountdown) {
      clearCountdownTimeouts();
      ['5', '4', '3', '2', '1'].forEach((digit, i) => {
        const t = setTimeout(() => {
          setVisualSignal(digit);
          triggerFlash();
        }, i * 900);
        countdownTimeoutsRef.current.push(t);
      });
    } else {
      setVisualSignal(cue.visual ?? cue.message);
      triggerFlash();
    }

    if (cueMode === 'prep') {
      playSound(cue.id);
      return;
    }
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
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: true });

    return () => {
      clearFlashTimeout();
      clearCountdownTimeouts();
      stopSound();
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
      <ScrollView contentContainerStyle={[styles.container, isLandscape && styles.containerLandscape]}>
        <View style={[styles.layout, isLandscape && styles.layoutLandscape]}>
          <View style={[styles.leftColumn, isLandscape && styles.leftColumnLandscape]}>
            <Text style={[styles.title, isLandscape && styles.titleLandscape]}>CCA EA Timer</Text>
            <View style={[styles.modeSelector, isLandscape ? styles.modeColumn : styles.modeRow]}>
              <Pressable
                accessibilityRole="button"
                style={[styles.modeButton, isLandscape && styles.modeButtonLandscape, mode === 'prep' && styles.modeButtonActive]}
                onPress={() => switchMode('prep')}
              >
                <Text style={[styles.modeButtonText, mode === 'prep' && styles.modeButtonTextActive]}>Prep</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={[styles.modeButton, isLandscape && styles.modeButtonLandscape, mode === 'speech' && styles.modeButtonActive]}
                onPress={() => switchMode('speech')}
              >
                <Text style={[styles.modeButtonText, mode === 'speech' && styles.modeButtonTextActive]}>Speaking</Text>
              </Pressable>
            </View>
            <Text style={[styles.timer, isLandscape && styles.timerLandscape]}>{formatFromSeconds(displaySeconds)}</Text>
          </View>

          <View style={[styles.rightColumn, isLandscape && styles.rightColumnLandscape]}>
            {mode === 'prep' ? (
              <Text style={[styles.modeDescription, isLandscape && styles.modeDescriptionLandscape]}>
                Spoken prep signals • Count Down from 5:00
              </Text>
            ) : null}

<View style={[styles.visualSignalCard, { maxHeight: height * 0.50 }]}>
              <Text adjustsFontSizeToFit numberOfLines={1} style={[styles.visualSignalValue, { fontSize: height * 0.44, lineHeight: height * 0.44 }]}>{visualSignal}</Text>
            </View>

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
          </View>
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
  containerLandscape: {
    paddingVertical: 18,
  },
  layout: {
    flex: 1,
    gap: 14,
  },
  layoutLandscape: {
    flexDirection: 'row',
    gap: 18,
  },
  leftColumn: {
    gap: 12,
  },
  leftColumnLandscape: {
    width: 220,
  },
  rightColumn: {
    gap: 14,
  },
  rightColumnLandscape: {
    flex: 1,
  },
  title: {
    color: '#f8fafc',
    fontSize: 30,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  titleLandscape: {
    textAlign: 'left',
    marginBottom: 0,
  },
  modeSelector: {
    gap: 10,
  },
  modeRow: {
    flexDirection: 'row',
  },
  modeColumn: {
    flexDirection: 'column',
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
  modeButtonLandscape: {
    flex: 0,
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
  modeDescriptionLandscape: {
    textAlign: 'left',
  },
  timer: {
    color: '#f8fafc',
    fontSize: 68,
    fontWeight: '700',
    textAlign: 'center',
    marginVertical: 8,
  },
  timerLandscape: {
    fontSize: 96,
    lineHeight: 104,
  },
  visualSignalCard: {
    borderRadius: 16,
    borderColor: '#f8fafc',
    borderWidth: 2,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1e293b',
  },
visualSignalValue: {
    color: '#f8fafc',
    fontWeight: '800',
    width: '100%',
    textAlign: 'center',
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
});
