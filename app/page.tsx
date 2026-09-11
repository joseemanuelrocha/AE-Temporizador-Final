'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Expand,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Save,
  Settings2,
  SkipForward,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  createRoom,
  getRoom,
  joinRoom,
  leaveRoom,
  liveAvailable,
  roomCode,
  updateRoom,
  type LiveRole,
  type LiveState,
} from '../lib/live-room';

type Mode = 'intervalos' | 'estacoes';
type Phase =
  | 'PRONTO'
  | 'PREPARAÇÃO'
  | 'TREINO'
  | 'DESCANSO'
  | 'TROCA'
  | 'CONCLUÍDO';
type Config = {
  work: number;
  rest: number;
  sets: number;
  prep: number;
  stations: number;
  rounds: number;
};
type Preset = { id: string; name: string; mode: Mode; config: Config };
const DEFAULTS: Config = {
  work: 40,
  rest: 20,
  sets: 8,
  prep: 5,
  stations: 6,
  rounds: 3,
};
const STORAGE_KEY = 'aae-trampolins-timer-v1';
const PHASE_COLOR: Record<Phase, string> = {
  PRONTO: '#f4f4f5',
  PREPARAÇÃO: '#FFC928',
  TREINO: '#7CFF00',
  DESCANSO: '#00CFFF',
  TROCA: '#00CFFF',
  CONCLUÍDO: '#7CFF00',
};

function clampInt(value: number, min: number, max: number) {
  return Math.max(
    min,
    Math.min(max, Math.round(Number.isFinite(value) ? value : min)),
  );
}
function formatTime(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function totalTrainingMs(mode: Mode, config: Config) {
  const units =
    mode === 'intervalos' ? config.sets : config.stations * config.rounds;
  return (
    (config.prep + units * config.work + Math.max(0, units - 1) * config.rest) *
    1000
  );
}

function NumberField({
  label,
  value,
  suffix,
  min = 1,
  max = 3600,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  suffix: string;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  if (label === 'Tempo de treino') {
    const minutes = Math.floor(value / 60);
    const seconds = value % 60;
    return (
      <fieldset className="time-field">
        <legend>{label}</legend>
        <label>
          <span>MINUTOS</span>
          <input
            aria-label={`${label} minutos`}
            type="number"
            min={0}
            value={minutes}
            onChange={(e) =>
              onChange(Math.max(0, Number(e.target.value) || 0) * 60 + seconds)
            }
          />
        </label>
        <label>
          <span>SEGUNDOS</span>
          <input
            aria-label={`${label} segundos`}
            type="number"
            min={0}
            max={59}
            value={seconds}
            onChange={(e) =>
              onChange(
                minutes * 60 +
                  Math.max(0, Math.min(59, Number(e.target.value) || 0)),
              )
            }
          />
        </label>
      </fieldset>
    );
  }
  return (
    <label className="number-field">
      <span>{label}</span>
      <span className="number-control">
        <button
          type="button"
          aria-label={`Diminuir ${label}`}
          disabled={value <= min}
          onClick={() => onChange(clampInt(value - 1, min, max))}
        >
          −
        </button>
        <input
          aria-label={label}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(clampInt(Number(e.target.value), min, max))}
        />
        <b>{suffix}</b>
        <button
          type="button"
          aria-label={`Aumentar ${label}`}
          disabled={value >= max}
          onClick={() => onChange(clampInt(value + 1, min, max))}
        >
          +
        </button>
      </span>
    </label>
  );
}
function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return (
    <fieldset className="time-field">
      <legend>{label}</legend>
      <label>
        <span>MINUTOS</span>
        <input
          type="number"
          min={0}
          value={minutes}
          onChange={(e) =>
            onChange(Math.max(0, Number(e.target.value) || 0) * 60 + seconds)
          }
        />
      </label>
      <label>
        <span>SEGUNDOS</span>
        <input
          type="number"
          min={0}
          max={59}
          value={seconds}
          onChange={(e) =>
            onChange(
              minutes * 60 +
                Math.max(0, Math.min(59, Number(e.target.value) || 0)),
            )
          }
        />
      </label>
    </fieldset>
  );
}

export default function Home() {
  const [mode, setMode] = useState<Mode>('intervalos');
  const [config, setConfig] = useState<Config>(DEFAULTS);
  const [phase, setPhase] = useState<Phase>('PRONTO');
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [remainingMs, setRemainingMs] = useState(DEFAULTS.prep * 1000);
  const [phaseDurationMs, setPhaseDurationMs] = useState(DEFAULTS.prep * 1000);
  const [totalDurationMs, setTotalDurationMs] = useState(
    totalTrainingMs('intervalos', DEFAULTS),
  );
  const [totalElapsedMs, setTotalElapsedMs] = useState(0);
  const [totalRemainingMs, setTotalRemainingMs] = useState(
    totalTrainingMs('intervalos', DEFAULTS),
  );
  const [currentSet, setCurrentSet] = useState(1);
  const [station, setStation] = useState(1);
  const [round, setRound] = useState(1);
  const [soundOn, setSoundOn] = useState(true);
  const [volume, setVolume] = useState(70);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetOpen, setPresetOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [liveRole, setLiveRole] = useState<LiveRole | null>(null);
  const [liveCode, setLiveCode] = useState('');
  const [liveToken, setLiveToken] = useState('');
  const [liveOpen, setLiveOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [liveError, setLiveError] = useState('');
  const [liveBusy, setLiveBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [timerName, setTimerName] = useState('');
  const [timerNameColor, setTimerNameColor] = useState('#ffffff');
  const [timerBgColor, setTimerBgColor] = useState('#090909');
  const endAtRef = useRef(0);
  const startedAtEpochRef = useRef<number | null>(null);
  const totalEndAtRef = useRef(0);
  const previousConfigRef = useRef(config);
  const audioRef = useRef<AudioContext | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const tickedRef = useRef<number | null>(null);
  const advanceRef = useRef<() => void>(() => {});
  const totalUnits =
    mode === 'intervalos' ? config.sets : config.stations * config.rounds;
  const completedUnits =
    phase === 'CONCLUÍDO'
      ? totalUnits
      : mode === 'intervalos'
        ? Math.max(0, currentSet - (phase === 'DESCANSO' ? 0 : 1))
        : Math.max(
            0,
            (round - 1) * config.stations +
              station -
              (phase === 'TROCA' ? 0 : 1),
          );
  const progress =
    phase === 'PRONTO'
      ? 1
      : phase === 'CONCLUÍDO'
        ? 0
        : Math.max(0, Math.min(1, remainingMs / Math.max(1, phaseDurationMs)));
  const elapsedMs =
    phase === 'PRONTO'
      ? 0
      : Math.max(0, Math.min(phaseDurationMs, phaseDurationMs - remainingMs));
  const alertCount =
    running && !paused && remainingMs > 0 && remainingMs <= 3000
      ? Math.ceil(remainingMs / 1000)
      : null;
  const color = PHASE_COLOR[phase];

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (saved.config) setConfig({ ...DEFAULTS, ...saved.config });
      if (saved.mode === 'intervalos' || saved.mode === 'estacoes')
        setMode(saved.mode);
      if (typeof saved.soundOn === 'boolean') setSoundOn(saved.soundOn);
      if (typeof saved.volume === 'number') setVolume(saved.volume);
      if (Array.isArray(saved.presets)) setPresets(saved.presets);
      if (typeof saved.timerName === 'string') setTimerName(saved.timerName);
      if (typeof saved.timerNameColor === 'string') setTimerNameColor(saved.timerNameColor);
      if (typeof saved.timerBgColor === 'string') setTimerBgColor(saved.timerBgColor);
    } catch {}
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated)
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ config, mode, soundOn, volume, presets, timerName, timerNameColor, timerBgColor }),
      );
  }, [config, mode, soundOn, volume, presets, timerName, timerNameColor, timerBgColor, hydrated]);

  const tone = useCallback(
    (kind: 'count' | 'work' | 'rest' | 'finish') => {
      if (!soundOn) return;
      const AudioCtor =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtor) return;
      const ctx = audioRef.current || new AudioCtor();
      audioRef.current = ctx;
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
      const notes =
        kind === 'finish'
          ? [660, 880, 1100]
          : kind === 'work'
            ? [720, 920]
            : kind === 'rest'
              ? [520, 420]
              : [760];
      notes.forEach((frequency, index) => {
        const start = ctx.currentTime + index * 0.16;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(
          Math.min(0.42, Math.max(0.03, volume / 235)),
          start + 0.02,
        );
        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          start + (kind === 'finish' ? 0.28 : 0.16),
        );
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.3);
      });
    },
    [soundOn, volume],
  );

  const beginPhase = useCallback(
    (next: Phase, seconds: number, cue?: 'work' | 'rest' | 'finish') => {
      const duration = Math.max(0, seconds * 1000);
      setPhase(next);
      setPhaseDurationMs(duration);
      setRemainingMs(duration);
      endAtRef.current = performance.now() + duration;
      startedAtEpochRef.current = Date.now();
      tickedRef.current = null;
      if (cue) tone(cue);
    },
    [tone],
  );
  const advance = useCallback(() => {
    if (phase === 'PREPARAÇÃO' || phase === 'PRONTO') {
      beginPhase('TREINO', config.work, 'work');
      return;
    }
    if (mode === 'intervalos') {
      if (phase === 'TREINO') {
        if (currentSet >= config.sets) {
          beginPhase('CONCLUÍDO', 0, 'finish');
          setTotalRemainingMs(0);
          setTotalElapsedMs(totalDurationMs);
          setRunning(false);
          return;
        }
        beginPhase('DESCANSO', config.rest, 'rest');
      } else if (phase === 'DESCANSO') {
        setCurrentSet((n) => n + 1);
        beginPhase('TREINO', config.work, 'work');
      }
      return;
    }
    if (phase === 'TREINO') {
      if (station >= config.stations && round >= config.rounds) {
        beginPhase('CONCLUÍDO', 0, 'finish');
        setTotalRemainingMs(0);
        setTotalElapsedMs(totalDurationMs);
        setRunning(false);
        return;
      }
      beginPhase('TROCA', config.rest, 'rest');
    } else if (phase === 'TROCA') {
      if (station >= config.stations) {
        setStation(1);
        setRound((n) => n + 1);
      } else setStation((n) => n + 1);
      beginPhase('TREINO', config.work, 'work');
    }
  }, [
    phase,
    mode,
    currentSet,
    config,
    station,
    round,
    beginPhase,
    totalDurationMs,
  ]);
  advanceRef.current = advance;

  useEffect(() => {
    if (!running || paused || phase === 'CONCLUÍDO') return;
    let frame = 0;
    const update = () => {
      const left = Math.max(0, endAtRef.current - performance.now());
      const totalLeft = Math.max(0, totalEndAtRef.current - performance.now());
      setRemainingMs(left);
      setTotalRemainingMs(totalLeft);
      setTotalElapsedMs(Math.max(0, totalDurationMs - totalLeft));
      const second = Math.ceil(left / 1000);
      if (second > 0 && second <= 3 && second !== tickedRef.current) {
        tickedRef.current = second;
        tone('count');
      }
      if (left <= 0) {
        advanceRef.current();
        return;
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [running, paused, phase, tone, totalDurationMs]);
  useEffect(() => {
    const keepAwake = async () => {
      if (running && !paused && 'wakeLock' in navigator) {
        try {
          wakeLockRef.current = await navigator.wakeLock.request('screen');
        } catch {}
      } else if (wakeLockRef.current) {
        try {
          await wakeLockRef.current.release();
        } catch {}
        wakeLockRef.current = null;
      }
    };
    void keepAwake().catch(() => undefined);
    return () => {
      const release = wakeLockRef.current?.release();
      if (release) void release.catch(() => undefined);
      wakeLockRef.current = null;
    };
  }, [running, paused]);
  useEffect(() => {
    const onFullscreen = () =>
      setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);
  useEffect(() => {
    if ('serviceWorker' in navigator)
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);
  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool?: (
            tool: unknown,
            options?: { signal?: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const controller = new AbortController();
    void Promise.resolve(
      context.registerTool(
        {
          name: 'configure_interval_timer',
          title: 'Configurar temporizador',
          description:
            'Configura o temporizador intervalado visível da AAE sem o iniciar.',
          inputSchema: {
            type: 'object',
            properties: {
              work: { type: 'integer', minimum: 1, maximum: 3600 },
              rest: { type: 'integer', minimum: 1, maximum: 3600 },
              sets: { type: 'integer', minimum: 1, maximum: 99 },
              prep: { type: 'integer', minimum: 1, maximum: 120 },
            },
            required: ['work', 'rest', 'sets', 'prep'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute(input: unknown) {
            const v = input as Partial<Config>;
            if (![v.work, v.rest, v.sets, v.prep].every(Number.isInteger))
              throw new Error('Valores inválidos.');
            const next = {
              ...config,
              work: clampInt(v.work!, 1, 3600),
              rest: clampInt(v.rest!, 1, 3600),
              sets: clampInt(v.sets!, 1, 99),
              prep: clampInt(v.prep!, 1, 120),
            };
            setMode('intervalos');
            setConfig(next);
            setPhase('PRONTO');
            setRunning(false);
            setPaused(false);
            setCurrentSet(1);
            setRemainingMs(next.prep * 1000);
            setPhaseDurationMs(next.prep * 1000);
            return {
              configured: true,
              mode: 'intervalos',
              work: next.work,
              rest: next.rest,
              sets: next.sets,
              prep: next.prep,
            };
          },
        },
        { signal: controller.signal },
      ),
    ).catch(() => undefined);
    return () => controller.abort();
  }, [config]);

  const start = () => {
    const total = totalTrainingMs(mode, config);
    setTotalDurationMs(total);
    setTotalElapsedMs(0);
    setTotalRemainingMs(total);
    totalEndAtRef.current = performance.now() + total;
    setCurrentSet(1);
    setStation(1);
    setRound(1);
    setRunning(true);
    setPaused(false);
    beginPhase('PREPARAÇÃO', config.prep);
  };
  const togglePause = () => {
    if (paused) {
      endAtRef.current = performance.now() + remainingMs;
      totalEndAtRef.current = performance.now() + totalRemainingMs;
      startedAtEpochRef.current = Date.now() - (phaseDurationMs - remainingMs);
      setPaused(false);
    } else {
      setTotalRemainingMs(
        Math.max(0, totalEndAtRef.current - performance.now()),
      );
      setPaused(true);
    }
  };
  const reset = () => {
    setRunning(false);
    setPaused(false);
    setPhase('PRONTO');
    setCurrentSet(1);
    setStation(1);
    setRound(1);
    setRemainingMs(config.prep * 1000);
    setPhaseDurationMs(config.prep * 1000);
    const total = totalTrainingMs(mode, config);
    setTotalDurationMs(total);
    setTotalElapsedMs(0);
    setTotalRemainingMs(total);
    setConfirmReset(false);
  };
  const updateConfig = (key: keyof Config, value: number) =>
    setConfig((prev) => ({ ...prev, [key]: value }));
  const switchMode = (next: Mode) => {
    if (running) return;
    setMode(next);
    setPhase('PRONTO');
    setCurrentSet(1);
    setStation(1);
    setRound(1);
    setRemainingMs(config.prep * 1000);
    setPhaseDurationMs(config.prep * 1000);
  };
  const savePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    setPresets((items) => {
      const match = items.find(
        (item) =>
          item.name.toLocaleLowerCase('pt') === name.toLocaleLowerCase('pt'),
      );
      return match
        ? items.map((item) =>
            item.id === match.id
              ? { ...item, name, mode, config: { ...config } }
              : item,
          )
        : [
            ...items,
            { id: crypto.randomUUID(), name, mode, config: { ...config } },
          ];
    });
    setPresetName('');
    setPresetOpen(false);
  };
  const loadPreset = (preset: Preset) => {
    if (running) return;
    setMode(preset.mode);
    setConfig(preset.config);
    setPhase('PRONTO');
    setRemainingMs(preset.config.prep * 1000);
    setPhaseDurationMs(preset.config.prep * 1000);
  };
  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement)
        await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch {}
  };
  const descriptor = useMemo(
    () =>
      mode === 'intervalos'
        ? `SÉRIE ${Math.min(currentSet, config.sets)} DE ${config.sets}`
        : `ESTAÇÃO ${station} DE ${config.stations}`,
    [mode, currentSet, config.sets, config.stations, station],
  );
  const liveState = useCallback(
    (): LiveState => ({
      public_code: liveCode,
      mode,
      status:
        phase === 'CONCLUÍDO'
          ? 'finished'
          : !running
            ? 'idle'
            : paused
              ? 'paused'
              : 'running',
      phase,
      config,
      duration_ms: phaseDurationMs,
      started_at: startedAtEpochRef.current,
      paused_remaining_ms: paused ? remainingMs : null,
      current_set: currentSet,
      station,
      round,
    }),
    [
      liveCode,
      mode,
      phase,
      config,
      phaseDurationMs,
      running,
      paused,
      currentSet,
      station,
      round,
    ],
  );
  const applyLiveState = useCallback((state: LiveState) => {
    setMode(state.mode);
    setConfig({ ...DEFAULTS, ...state.config });
    setPhase(state.phase as Phase);
    setPhaseDurationMs(state.duration_ms);
    setCurrentSet(state.current_set);
    setStation(state.station);
    setRound(state.round);
    startedAtEpochRef.current = state.started_at;
    const left =
      state.status === 'paused'
        ? state.paused_remaining_ms || 0
        : state.status === 'running' && state.started_at
          ? Math.max(0, state.started_at + state.duration_ms - Date.now())
          : 0;
    setRemainingMs(left);
    endAtRef.current = performance.now() + left;
    setRunning(state.status === 'running' || state.status === 'paused');
    setPaused(state.status === 'paused');
  }, []);
  useEffect(() => {
    if (liveRole !== 'host' || !liveCode || !liveToken) return;
    void updateRoom(liveCode, liveToken, liveState()).catch(() => undefined);
  }, [liveRole, liveCode, liveToken, liveState]);
  useEffect(() => {
    if (liveRole !== 'viewer' || !liveCode) return;
    const sync = () =>
      void getRoom(liveCode)
        .then((state) => {
          if (state) applyLiveState(state);
        })
        .catch(() => undefined);
    sync();
    const id = window.setInterval(sync, 1500);
    return () => window.clearInterval(id);
  }, [liveRole, liveCode, applyLiveState]);
  useEffect(() => {
    const total = totalTrainingMs(mode, config);
    if (!running) {
      setTotalDurationMs(total);
      setTotalRemainingMs(total);
      setTotalElapsedMs(0);
    } else {
      const elapsed = Math.min(total, totalElapsedMs);
      const left = Math.max(0, total - elapsed);
      setTotalDurationMs(total);
      setTotalRemainingMs(left);
      totalEndAtRef.current = performance.now() + left;
      const previousPhaseSeconds =
        phase === 'TREINO'
          ? previousConfigRef.current.work
          : phase === 'DESCANSO' || phase === 'TROCA'
            ? previousConfigRef.current.rest
            : 0;
      const nextPhaseSeconds =
        phase === 'TREINO'
          ? config.work
          : phase === 'DESCANSO' || phase === 'TROCA'
            ? config.rest
            : 0;
      if (previousPhaseSeconds !== nextPhaseSeconds && nextPhaseSeconds > 0) {
        const phaseElapsed = Math.max(0, phaseDurationMs - remainingMs);
        const nextDuration = nextPhaseSeconds * 1000;
        const nextLeft = Math.max(0, nextDuration - phaseElapsed);
        setPhaseDurationMs(nextDuration);
        setRemainingMs(nextLeft);
        endAtRef.current = performance.now() + nextLeft;
      }
    }
    previousConfigRef.current = config;
  }, [mode, config, running, phase]);
  const createLive = async () => {
    if (!liveAvailable) {
      setLiveError('Configure o Supabase para ativar esta função.');
      return;
    }
    setLiveBusy(true);
    setLiveError('');
    try {
      const code = roomCode();
      const initial: LiveState = {
        public_code: code,
        mode,
        status: 'idle',
        phase: 'PRONTO',
        config,
        duration_ms: config.prep * 1000,
        started_at: null,
        paused_remaining_ms: null,
        current_set: 1,
        station: 1,
        round: 1,
      };
      const token = await createRoom(initial);
      setLiveCode(code);
      setLiveToken(token);
      setLiveRole('host');
      setLiveOpen(false);
    } catch (error) {
      setLiveError(
        error instanceof Error
          ? error.message
          : 'Não foi possível criar a sala.',
      );
    } finally {
      setLiveBusy(false);
    }
  };
  const enterLive = async () => {
    if (!liveAvailable) {
      setLiveError('Configure o Supabase para ativar esta função.');
      return;
    }
    setLiveBusy(true);
    setLiveError('');
    try {
      const code = joinCode.trim().toUpperCase();
      const state = await joinRoom(code);
      applyLiveState(state);
      setLiveCode(code);
      setLiveRole('viewer');
      setLiveOpen(false);
    } catch (error) {
      setLiveError(
        error instanceof Error
          ? error.message
          : 'Não foi possível entrar na sala.',
      );
    } finally {
      setLiveBusy(false);
    }
  };
  const exitLive = () => {
    if (liveCode) void leaveRoom(liveCode).catch(() => undefined);
    setLiveRole(null);
    setLiveCode('');
    setLiveToken('');
  };

  const viewer = liveRole === 'viewer';
  return (
    <main
      className={`app ${running ? 'is-running' : ''} ${fullscreen ? 'is-fullscreen' : ''} ${viewer ? 'is-viewer' : ''} ${showConfig ? 'config-open' : ''}`}
      style={{ '--phase': color, '--timer-name': timerNameColor, backgroundColor: timerBgColor } as React.CSSProperties}
    >
      <header className="topbar">
        <div className="brand-lockup">
          <span className="logo-plaque">
            <img
              src="/brand/logo-aae.png"
              alt="Associação Académica de Espinho"
            />
          </span>
          <div>
            <b>AAE</b>
            <span>GINÁSTICA DE TRAMPOLINS</span>
          </div>
        </div>
        <label className="timer-identity">
          <span>IDENTIFICAÇÃO</span>
          <input
            className="timer-name-input"
            aria-label="Identificação do temporizador"
            value={timerName}
            maxLength={32}
            placeholder="Ex.: Trampolim 1"
            onChange={(event) => setTimerName(event.target.value)}
          />
          <input
            className="timer-name-color"
            type="color"
            aria-label="Cor da identificação"
            value={timerNameColor}
            onChange={(event) => setTimerNameColor(event.target.value)}
          />
          <input
            className="timer-bg-color"
            type="color"
            aria-label="Cor do fundo do cronómetro"
            value={timerBgColor}
            onChange={(event) => setTimerBgColor(event.target.value)}
          />
        </label>
        <img
          className="trampoline-logo"
          src="/brand/logo-trampolins.png"
          alt="Secção de Trampolins da AAE"
        />
        <div className="top-actions">
          {liveRole ? (
            <button className="live-status" onClick={exitLive}>
              {liveRole === 'host' ? 'EM DIRETO' : 'A ACOMPANHAR'} · {liveCode}{' '}
              <X />
            </button>
          ) : (
            <button
              className="live-button"
              onClick={() => setLiveOpen(true)}
              disabled={running}
            >
              <Radio /> TREINO EM DIRETO
            </button>
          )}
          <button
            className="icon-button"
            onClick={() => setSoundOn((v) => !v)}
            aria-label={soundOn ? 'Desativar som' : 'Ativar som'}
          >
            {soundOn ? <Volume2 /> : <VolumeX />}
          </button>
          <label className="volume">
            <span>VOLUME</span>
            <input
              aria-label="Volume"
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
            />
          </label>
          <button className="fullscreen-button" onClick={toggleFullscreen}>
            <Expand />
            <span>ECRÃ INTEIRO</span>
          </button>
        </div>
      </header>
      <section className="workspace">
        <aside className={`config-panel ${showConfig ? 'mobile-open' : ''}`}>
          <div className="panel-title">
            <span>
              <Settings2 /> CONFIGURAÇÃO
            </span>
            <button
              className="mobile-close"
              onClick={() => setShowConfig(false)}
              aria-label="Fechar configuração"
            >
              <X />
            </button>
          </div>
          <div
            className="mode-tabs"
            role="tablist"
            aria-label="Modo do temporizador"
          >
            <button
              role="tab"
              aria-selected={mode === 'intervalos'}
              onClick={() => switchMode('intervalos')}
            >
              INTERVALOS
            </button>
            <button
              role="tab"
              aria-selected={mode === 'estacoes'}
              onClick={() => switchMode('estacoes')}
            >
              ESTAÇÕES
            </button>
          </div>
          <div className="fields">
            <NumberField
              label="Tempo de treino"
              value={config.work}
              suffix="SEG"
              onChange={(v) => updateConfig('work', v)}
              disabled={running || viewer}
            />
            <NumberField
              label={
                mode === 'intervalos' ? 'Tempo de descanso' : 'Tempo de troca'
              }
              value={config.rest}
              suffix="SEG"
              onChange={(v) => updateConfig('rest', v)}
              disabled={running || viewer}
            />
            {mode === 'intervalos' ? (
              <NumberField
                label="Séries"
                value={config.sets}
                suffix="TOTAL"
                max={99}
                onChange={(v) => updateConfig('sets', v)}
                disabled={running || viewer}
              />
            ) : (
              <>
                <NumberField
                  label="Estações"
                  value={config.stations}
                  suffix="TOTAL"
                  max={30}
                  onChange={(v) => updateConfig('stations', v)}
                  disabled={running || viewer}
                />
                <NumberField
                  label="Voltas"
                  value={config.rounds}
                  suffix="TOTAL"
                  max={20}
                  onChange={(v) => updateConfig('rounds', v)}
                  disabled={running || viewer}
                />
              </>
            )}
            <NumberField
              label="Preparação"
              value={config.prep}
              suffix="SEG"
              max={120}
              onChange={(v) => updateConfig('prep', v)}
              disabled={running || viewer}
            />
          </div>
          <button
            className="save-button"
            disabled={running || viewer}
            onClick={() => setPresetOpen(true)}
          >
            <Save /> GUARDAR TREINO
          </button>
          {presets.length > 0 && (
            <div className="presets">
              <p>FAVORITOS</p>
              {presets.map((preset) => (
                <div key={preset.id} className="preset-row">
                  <button
                    onClick={() => loadPreset(preset)}
                    disabled={running || viewer}
                  >
                    <span>{preset.name}</span>
                    <small>
                      {preset.config.work}s / {preset.config.rest}s ·{' '}
                      {preset.mode === 'intervalos'
                        ? `${preset.config.sets} séries`
                        : `${preset.config.stations} × ${preset.config.rounds}`}
                    </small>
                  </button>
                  <button
                    aria-label={`Eliminar ${preset.name}`}
                    onClick={() =>
                      setPresets((items) =>
                        items.filter((item) => item.id !== preset.id),
                      )
                    }
                  >
                    <Trash2 />
                  </button>
                </div>
              ))}
            </div>
          )}
        </aside>
        <section className="timer-stage" aria-live="polite">
          {phase === 'CONCLUÍDO' ? (
            <div className="completion-screen">
              <img src="/brand/logo-trampolins.png" alt="Trampolins AAE" />
              <strong>TREINO CONCLUÍDO</strong>
              <span>
                {totalUnits} {mode === 'intervalos' ? 'SÉRIES' : 'ESTAÇÕES'}{' '}
                CONCLUÍDAS
              </span>
            </div>
          ) : (
            <>
              <div className="timer-name-display" style={{ color: 'var(--timer-name)' }}>
                {timerName || 'TEMPORIZADOR AAE'}
              </div>
              <div className="phase-heading">
                <span className="live-dot" />
                {paused ? 'EM PAUSA' : phase}
              </div>
              <div
                className={`timer-mark ${alertCount ? 'countdown-alert' : ''}`}
              >
                <svg
                  className="progress-triangle"
                  viewBox="0 0 520 470"
                  aria-hidden="true"
                >
                  <path
                    className="triangle-track"
                    pathLength="100"
                    d="M260 24 L494 438 L26 438 Z"
                  />
                  <path
                    className="triangle-progress"
                    pathLength="100"
                    d="M260 24 L494 438 L26 438 Z"
                    style={{ strokeDashoffset: 100 - progress * 100 }}
                  />
                </svg>
                <div className="logo-core" aria-hidden="true">
                  <img src="/brand/logo-aae.png" alt="" />
                </div>
                <div className="time-readout">
                  <strong>{formatTime(remainingMs)}</strong>
                  {alertCount && (
                    <span className="count-number">{alertCount}</span>
                  )}
                </div>
              </div>
              <div className="session-meta">
                <strong>{descriptor}</strong>
                {mode === 'estacoes' && (
                  <span>
                    VOLTA {round} DE {config.rounds}
                  </span>
                )}
                <span>
                  {completedUnits} CONCLUÍDAS ·{' '}
                  {Math.max(0, totalUnits - completedUnits)} POR FAZER
                </span>
              </div>
              <div className="time-stats">
                <span>
                  FASE DECORRIDA <b>{formatTime(elapsedMs)}</b>
                </span>
                <span>
                  FASE RESTANTE <b>{formatTime(remainingMs)}</b>
                </span>
              </div>
              <div className="total-time-stats">
                <span>
                  TEMPO TOTAL DECORRIDO <b>{formatTime(totalElapsedMs)}</b>
                </span>
                <span>
                  TEMPO TOTAL RESTANTE <b>{formatTime(totalRemainingMs)}</b>
                </span>
              </div>
              <div
                className="series-dots"
                aria-label={`${completedUnits} de ${totalUnits} concluídas`}
              >
                {Array.from({ length: Math.min(totalUnits, 36) }, (_, i) => (
                  <span
                    key={i}
                    className={
                      i < completedUnits
                        ? 'done'
                        : i === completedUnits && running
                          ? 'current'
                          : ''
                    }
                  />
                ))}
              </div>
            </>
          )}
        </section>
      </section>
      <footer className="controls">
        {viewer ? (
          <button className="reset-action" onClick={exitLive}>
            <X /> SAIR DA SALA
          </button>
        ) : (
          <>
            <button
              className="mobile-config"
              onClick={() => setShowConfig(true)}
            >
              <Settings2 /> CONFIGURAR
            </button>
            {!running && phase !== 'CONCLUÍDO' && (
              <button className="primary-action" onClick={start}>
                <Play /> INICIAR
              </button>
            )}
            {running && (
              <button className="primary-action" onClick={togglePause}>
                {paused ? <Play /> : <Pause />}
                {paused ? 'CONTINUAR' : 'PAUSAR'}
              </button>
            )}
            {phase === 'CONCLUÍDO' && (
              <button className="primary-action" onClick={reset}>
                <Play /> NOVO TREINO
              </button>
            )}
            <button onClick={advance} disabled={!running}>
              <SkipForward /> AVANÇAR
            </button>
            {mode === 'intervalos' && (
              <button
                className="series-control"
                onClick={() => setConfig((c) => ({ ...c, sets: c.sets + 1 }))}
              >
                <Plus /> 1 SÉRIE
              </button>
            )}
            <button
              className="reset-action"
              onClick={() => (running ? setConfirmReset(true) : reset())}
            >
              <RotateCcw /> {fullscreen && running ? 'PARAR' : 'REINICIAR'}
            </button>
          </>
        )}
      </footer>
      {presetOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(e) =>
            e.target === e.currentTarget && setPresetOpen(false)
          }
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-title"
          >
            <button
              className="modal-x"
              onClick={() => setPresetOpen(false)}
              aria-label="Fechar"
            >
              <X />
            </button>
            <span className="eyebrow">FAVORITOS</span>
            <h2 id="save-title">Guardar configuração</h2>
            <p>
              Dê um nome fácil de reconhecer. Um nome já existente será
              atualizado.
            </p>
            <input
              autoFocus
              placeholder="Ex.: Circuito Iniciados"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && savePreset()}
            />
            <button
              className="primary-action"
              disabled={!presetName.trim()}
              onClick={savePreset}
            >
              <Save /> GUARDAR
            </button>
          </div>
        </div>
      )}
      {liveOpen && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal live-modal" role="dialog" aria-modal="true">
            <button
              className="modal-x"
              onClick={() => setLiveOpen(false)}
              aria-label="Fechar"
            >
              <X />
            </button>
            <span className="eyebrow">TREINO EM DIRETO</span>
            <h2>Partilhar este treino</h2>
            <p>Até 3 dispositivos. O treinador mantém sempre os controlos.</p>
            <button
              className="primary-action"
              disabled={liveBusy}
              onClick={createLive}
            >
              <Radio /> CRIAR SALA
            </button>
            <div className="live-divider">OU ENTRAR NUMA SALA</div>
            <input
              placeholder="AAE-4821"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && enterLive()}
            />
            <button disabled={liveBusy || !joinCode.trim()} onClick={enterLive}>
              ENTRAR COMO VISUALIZADOR
            </button>
            {liveError && <small className="live-error">{liveError}</small>}
          </div>
        </div>
      )}
      {confirmReset && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="reset-title"
          >
            <span className="danger-icon">
              <RotateCcw />
            </span>
            <h2 id="reset-title">Reiniciar o treino?</h2>
            <p>O progresso atual será perdido.</p>
            <div>
              <button onClick={() => setConfirmReset(false)}>CANCELAR</button>
              <button className="danger-button" onClick={reset}>
                SIM, REINICIAR
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
