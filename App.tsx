import { Audio } from 'expo-av';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Linking, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

type TimerMode = 'prep' | 'speech';

type Cue = {
  id: string;
  atSeconds: number;
  message: string;
  visual?: string;
  countdown?: boolean;
};

const FLASH_COUNT = 10;
const TOGGLES_PER_COMPLETE_FLASH = 2;
const FLASH_INTERVAL_MS = 120;
const FLASH_START_DELAY_MS = 16;

const MIN_DURATION_SECONDS = 60;
const MAX_DURATION_SECONDS = 300;
const DURATION_STEP = 30;

const APP_INSTALL_URL = 'https://expo.dev/accounts/[account]/projects/ccaeat-expo/builds';

const ALL_PREP_CUES: Cue[] = [
  { id: 'prep-4m', atSeconds: 240, message: '4 minutes.', visual: '4' },
  { id: 'prep-3m', atSeconds: 180, message: '3 minutes.', visual: '3' },
  { id: 'prep-2m', atSeconds: 120, message: '2 minutes.', visual: '2' },
  { id: 'prep-1m', atSeconds: 60, message: '1 minute.', visual: '1' },
  { id: 'prep-30s', atSeconds: 30, message: '30 seconds.', visual: '30s' },
  { id: 'prep-5s', atSeconds: 5, message: '5-4-3-2-1 Time.', countdown: true },
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
  const [visualSignal, setVisualSignal] = useState('');
  const [flashVisible, setFlashVisible] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [prepDurationSeconds, setPrepDurationSeconds] = useState(300);
  const [speechDurationSeconds, setSpeechDurationSeconds] = useState(300);
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
  const signalOpacity = useRef(new Animated.Value(0)).current;
  const signalFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signalAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  const prepCues = useMemo(
    () => ALL_PREP_CUES.filter((c) => c.atSeconds < prepDurationSeconds),
    [prepDurationSeconds],
  );

  const speechCues = useMemo((): Cue[] => {
    const marks: Cue[] = [
      { id: 'speech-4m', atSeconds: speechDurationSeconds - 240, message: 'Hold up 4 fingers.', visual: '4' },
      { id: 'speech-3m', atSeconds: speechDurationSeconds - 180, message: 'Hold up 3 fingers.', visual: '3' },
      { id: 'speech-2m', atSeconds: speechDurationSeconds - 120, message: 'Hold up 2 fingers.', visual: '2' },
      { id: 'speech-1m', atSeconds: speechDurationSeconds - 60, message: 'Hold up 1 finger.', visual: '1' },
      { id: 'speech-30s', atSeconds: speechDurationSeconds - 30, message: 'Show 30 seconds remaining.', visual: '30s' },
      { id: 'speech-5s', atSeconds: speechDurationSeconds - 5, message: 'Show 5-4-3-2-1 finger countdown.', countdown: true },
    ];
    return marks.filter((c) => c.atSeconds > 0);
  }, [speechDurationSeconds]);

  const displaySeconds = useMemo(() => {
    if (mode === 'prep') {
      const remaining = Math.max(0, prepDurationSeconds - elapsedMs / 1000);
      return Math.ceil(remaining);
    }
    return Math.floor(elapsedMs / 1000);
  }, [elapsedMs, mode, prepDurationSeconds]);

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

  const showSignal = (text: string) => {
    if (signalFadeTimerRef.current) {
      clearTimeout(signalFadeTimerRef.current);
      signalFadeTimerRef.current = null;
    }
    signalAnimRef.current?.stop();
    setVisualSignal(text);
    signalOpacity.setValue(1);
    signalFadeTimerRef.current = setTimeout(() => {
      const anim = Animated.timing(signalOpacity, {
        toValue: 0,
        duration: 800,
        useNativeDriver: true,
      });
      signalAnimRef.current = anim;
      anim.start(({ finished }) => {
        if (finished) setVisualSignal('');
      });
    }, 5000);
  };

  const triggerFlash = () => {
    clearFlashTimeout();
    setFlashVisible(false);
    const sequenceId = flashSequenceRef.current;
    flashTogglesRemainingRef.current = FLASH_COUNT * TOGGLES_PER_COMPLETE_FLASH;

    flashStartTimeoutRef.current = setTimeout(() => {
      if (flashSequenceRef.current !== sequenceId) return;
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

  const clearSignal = () => {
    if (signalFadeTimerRef.current) {
      clearTimeout(signalFadeTimerRef.current);
      signalFadeTimerRef.current = null;
    }
    signalAnimRef.current?.stop();
    signalOpacity.setValue(0);
    setVisualSignal('');
  };

  const resetTimer = () => {
    setRunning(false);
    setElapsedMs(0);
    setReportedSpeechTime(null);
    setFlashVisible(false);
    clearFlashTimeout();
    clearCountdownTimeouts();
    clearSignal();
    stopSound();
    firedCuesRef.current.clear();
    previousElapsedMsRef.current = 0;
    tickTimestampRef.current = null;
  };

  const switchMode = (nextMode: TimerMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    resetTimer();
  };

  const addCue = (cue: Cue, cueMode: TimerMode) => {
    firedCuesRef.current.add(cue.id);

    if (cue.countdown) {
      clearCountdownTimeouts();
      ['5', '4', '3', '2', '1'].forEach((digit, i) => {
        const t = setTimeout(() => {
          showSignal(digit);
          triggerFlash();
        }, i * 900);
        countdownTimeoutsRef.current.push(t);
      });
    } else {
      showSignal(cue.visual ?? cue.message);
      triggerFlash();
    }

    if (cueMode === 'prep') {
      playSound(cue.id);
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
        if (mode === 'prep') return Math.min(next, prepDurationSeconds * 1000);
        return next;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [mode, prepDurationSeconds, running]);

  useEffect(() => {
    if (mode === 'prep' && elapsedMs >= prepDurationSeconds * 1000 && running) {
      setRunning(false);
    }
  }, [elapsedMs, mode, prepDurationSeconds, running]);

  useEffect(() => {
    const previousElapsed = previousElapsedMsRef.current;
    const currentElapsed = elapsedMs;

    if (mode === 'prep') {
      const previousRemaining = Math.max(0, prepDurationSeconds - previousElapsed / 1000);
      const currentRemaining = Math.max(0, prepDurationSeconds - currentElapsed / 1000);
      prepCues.forEach((cue) => {
        if (!firedCuesRef.current.has(cue.id) && previousRemaining > cue.atSeconds && currentRemaining <= cue.atSeconds) {
          addCue(cue, 'prep');
        }
      });
    } else {
      const previousSeconds = previousElapsed / 1000;
      const currentSeconds = currentElapsed / 1000;
      speechCues.forEach((cue) => {
        if (!firedCuesRef.current.has(cue.id) && previousSeconds < cue.atSeconds && currentSeconds >= cue.atSeconds) {
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
    if (!running && mode === 'prep' && elapsedMs >= prepDurationSeconds * 1000) {
      resetTimer();
    }
    if (running && mode === 'speech') {
      setReportedSpeechTime(formatFromSeconds(Math.floor(elapsedMs / 1000)));
    }
    setRunning((previous) => !previous);
  };

  if (showSettings) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={[styles.settingsContainer, isLandscape && styles.settingsContainerLandscape]}>
          <Text style={styles.settingsTitle}>Settings</Text>

          <View style={styles.settingBlock}>
            <Text style={styles.settingLabel}>Prep Time</Text>
            <View style={styles.settingControl}>
              <Pressable
                style={styles.stepButton}
                onPress={() => setPrepDurationSeconds((v) => Math.max(MIN_DURATION_SECONDS, v - DURATION_STEP))}
              >
                <Text style={styles.stepButtonText}>−</Text>
              </Pressable>
              <Text style={styles.settingValue}>{formatFromSeconds(prepDurationSeconds)}</Text>
              <Pressable
                style={styles.stepButton}
                onPress={() => setPrepDurationSeconds((v) => Math.min(MAX_DURATION_SECONDS, v + DURATION_STEP))}
              >
                <Text style={styles.stepButtonText}>+</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.settingBlock}>
            <Text style={styles.settingLabel}>Speech Time</Text>
            <View style={styles.settingControl}>
              <Pressable
                style={styles.stepButton}
                onPress={() => setSpeechDurationSeconds((v) => Math.max(MIN_DURATION_SECONDS, v - DURATION_STEP))}
              >
                <Text style={styles.stepButtonText}>−</Text>
              </Pressable>
              <Text style={styles.settingValue}>{formatFromSeconds(speechDurationSeconds)}</Text>
              <Pressable
                style={styles.stepButton}
                onPress={() => setSpeechDurationSeconds((v) => Math.min(MAX_DURATION_SECONDS, v + DURATION_STEP))}
              >
                <Text style={styles.stepButtonText}>+</Text>
              </Pressable>
            </View>
          </View>

          <Pressable style={styles.doneButton} onPress={() => setShowSettings(false)}>
            <Text style={styles.doneButtonText}>Done</Text>
          </Pressable>

          <Text style={styles.brandingText}>
            Created for{' '}
            <Text style={styles.brandingLink} onPress={() => Linking.openURL('https://www.ccadebate.org/')}>CCA</Text>
            {' '}by{' '}
            <Text style={styles.brandingLink} onPress={() => Linking.openURL('https://www.americanappworks.com/')}>American Appworks, LLC</Text>
          </Text>

          <View style={styles.qrSection}>
            <Text style={styles.qrLabel}>Share this app</Text>
            <View style={styles.qrCode}>
              <QRCode value={APP_INSTALL_URL} size={160} color="#f8fafc" backgroundColor="#1e293b" />
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      {flashVisible ? <View pointerEvents="none" style={styles.flashOverlay} /> : null}
      <ScrollView contentContainerStyle={[styles.container, isLandscape && styles.containerLandscape]}>
        <View style={[styles.layout, isLandscape && styles.layoutLandscape]}>
          <View style={[styles.leftColumn, isLandscape && styles.leftColumnLandscape]}>
            <View style={styles.titleRow}>
              <Text style={[styles.title, isLandscape && styles.titleLandscape]}>{isLandscape ? 'Limited Prep' : 'Limited Prep Timer'}</Text>
              <Pressable onPress={() => { resetTimer(); setShowSettings(true); }} style={styles.settingsButton}>
                <Text style={styles.settingsButtonText}>⚙</Text>
              </Pressable>
            </View>
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
            <View style={[styles.visualSignalCard, { maxHeight: height * 0.50 }]}>
              <Animated.View style={{ opacity: signalOpacity, width: '100%' }}>
                <Text adjustsFontSizeToFit numberOfLines={1} style={[styles.visualSignalValue, { fontSize: height * 0.44, lineHeight: height * 0.44 }]}>{visualSignal}</Text>
              </Animated.View>
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  title: {
    color: '#f8fafc',
    fontSize: 30,
    fontWeight: '700',
    textAlign: 'center',
  },
  titleLandscape: {
    textAlign: 'left',
  },
  settingsButton: {
    padding: 4,
  },
  settingsButtonText: {
    color: '#94a3b8',
    fontSize: 22,
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
  settingsContainer: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingVertical: 28,
    gap: 24,
  },
  settingsContainerLandscape: {
    paddingVertical: 14,
    gap: 14,
  },
  settingsTitle: {
    color: '#f8fafc',
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
  },
  settingBlock: {
    gap: 14,
  },
  settingLabel: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  settingControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
  },
  stepButton: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepButtonText: {
    color: '#f8fafc',
    fontSize: 28,
    fontWeight: '300',
    lineHeight: 32,
  },
  settingValue: {
    color: '#f8fafc',
    fontSize: 48,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
  },
  doneButton: {
    backgroundColor: '#22c55e',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  doneButtonText: {
    color: '#0f172a',
    fontSize: 18,
    fontWeight: '700',
  },
  brandingText: {
    color: '#475569',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
  },
  brandingLink: {
    color: '#60a5fa',
    textDecorationLine: 'underline',
  },
  qrSection: {
    alignItems: 'center',
    gap: 10,
  },
  qrLabel: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  qrCode: {
    padding: 12,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
});
