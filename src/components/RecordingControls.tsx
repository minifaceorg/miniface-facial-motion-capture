/*
 * Copyright (c) 2025 Pooya Moradi M. poamrd@gmail.com https://github.com/PooyaDeperson
 * Licensed under the MIT License with Attribution.
 */

/**
 * RecordingControls.tsx
 *
 * Fixed bottom-center pill UI that drives the motion-capture recording flow.
 *
 * Phases
 * ──────
 * idle      → "Record" button (only when mediapipeReady && avatarReady)
 * recording → pulsing red dot + live MM:SS timer + frame counter + "Stop"
 *
 * On stop, the GLB is built in memory and App.tsx opens the Motion Library
 * with the newly saved motion pre-selected.
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import {
  subscribeRecorder,
  getRecorderState,
  startRecording,
  stopRecording,
  discardRecording,
  MAX_RECORDING_SECONDS,
} from "../useMotionRecorder";

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// ─── props ────────────────────────────────────────────────────────────────────

interface RecordingControlsProps {
  mediapipeReady: boolean;
  avatarReady: boolean;
  onPhaseChange?: (phase: Phase) => void;
  /** Called when the user clicks "do another" — lets App clear playback state */
  onDoAnother?: () => void;
  /** When true, hides the idle "record" button (playback is already running) */
  hideIdleWhenPlaying?: boolean;
}

type Phase = "idle" | "recording" | "review" | "done";

// ─── component ────────────────────────────────────────────────────────────────

const RecordingControls: React.FC<RecordingControlsProps> = ({
  mediapipeReady,
  avatarReady,
  onPhaseChange,
  onDoAnother: onDoAnotherProp,
  hideIdleWhenPlaying = false,
}) => {
  const [phase, setPhase] = useState<Phase>("idle");
  const [frameCount, setFrameCount] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const setPhaseAndNotify = useCallback((newPhase: Phase) => {
    setPhase(newPhase);
    onPhaseChange?.(newPhase);
  }, [onPhaseChange]);

  // Live interval ref for timer
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── sync with recorder singleton ────────────────────────────────────────────
  useEffect(() => {
    const syncState = () => {
      const state = getRecorderState();
      if (state.isRecording) {
        setPhaseAndNotify("recording");
        setFrameCount(state.frameCount);
      } else if (state.hasFrames) {
        // Stay in review; don't reset if already in review/done.
        // IMPORTANT: never call onPhaseChange inside a setPhase updater —
        // that would fire a parent setState during React's render phase and
        // trigger the "Cannot update a component while rendering" warning
        // (which also stalls the click handler by ~400 ms and blocks the rAF loop).
        setPhase((prev) => (prev === "idle" ? "review" : prev));
        // Fire the parent notification outside the updater, in the effect body.
        onPhaseChange?.("review");
        setFrameCount(state.frameCount);
        setElapsed(state.duration);
      } else {
        setPhaseAndNotify("idle");
        setFrameCount(0);
        setElapsed(0);
      }
    };
    const unsub = subscribeRecorder(syncState);
    syncState();
    return unsub;
  }, [setPhaseAndNotify, onPhaseChange]);

  // ── live timer while recording ───────────────────────────────────────────────
  useEffect(() => {
    if (phase === "recording") {
      timerRef.current = setInterval(() => {
        const state = getRecorderState();
        const duration = Math.min(state.duration, MAX_RECORDING_SECONDS);
        setElapsed(duration);
        setFrameCount(state.frameCount);
        if (duration >= MAX_RECORDING_SECONDS) {
          // Use the same handler as the visible Stop button so the automatic
          // transition renders and saves exactly like a manual stop.
          handleStop();
        }
      }, 100);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // handleStop is declared below and is stable; keep this timer tied to phase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── handlers ─────────────────────────────────────────────────────────────────
  const handleRecord = useCallback(() => {
    startRecording();
    setPhaseAndNotify("recording");
    setElapsed(0);
    setFrameCount(0);
  }, [setPhaseAndNotify]);

  const handleStop = useCallback(() => {
    // stopRecording() builds the GLB blob and notifies subscribePlaybackReady,
    // which causes App.tsx to open the library with the new motion selected.
    stopRecording();
    setPhaseAndNotify("idle");
    const state = getRecorderState();
    setFrameCount(state.frameCount);
    setElapsed(state.duration);
  }, [setPhaseAndNotify]);

  const handleDoAnother = useCallback(() => {
    discardRecording();
    setPhaseAndNotify("idle");
    setFrameCount(0);
    setElapsed(0);
    onDoAnotherProp?.();
  }, [setPhaseAndNotify, onDoAnotherProp]);

  // ── visibility guard ─────────────────────────────────────────────────────────
  const isActivePhase = phase === "recording";
  const showIdle = phase === "idle" && !hideIdleWhenPlaying && (avatarReady && mediapipeReady);
  if (!isActivePhase && !showIdle) return null;

  // ── render ───────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── IDLE: Record button (hidden while playback is active) ── */}
      {showIdle && (
        <div
          data-onboarding="record:record-your-first-motion"
          className="recording-controls reveal bottom-36 tb:bottom-50 fade pos-fixed z-rec recording-idle-container"
          role="region"
          aria-label="Motion capture recording"
        >
          <button
            className="rec-btn pos-rel rec-btn-record pt-10 pb-10 pl-22 pr-22 outline-5 outline-soft gap-2 record-button"
            onClick={handleRecord}
            aria-label="Start recording motion"
          >
            <span className="rec-dot rec-dot-idle" aria-hidden="true" />
            <span>record</span>
          </button>
        </div>
      )}

      {/* ── RECORDING: Stop button ── */}
      {phase === "recording" && (
        <div
          className="recording-controls reveal bottom-36 tb:bottom-50 fade pos-fixed z-rec recording-active-container"
          role="region"
          aria-label="Motion capture recording"
        >
          <div
            className="rec-bar rec-bar-live outline-5 outline-softdanger recording-bar"
            role="status"
            aria-live="polite"
          >
            <button
              className="rec-btn rec-btn-stop bg-danger gap-3 pl-22 pr-22 pt-10 pb-3 stop-button"
              onClick={handleStop}
              aria-label="Stop recording"
            >
              <span className="rec-stop-icon" aria-hidden="true" />
              stop
              <span className="rec-timer" aria-label={`Recording time: ${formatTime(elapsed)}`}>
                {formatTime(elapsed)}
              </span>
              <span className="rec-frames" aria-label={`${frameCount} frames captured`}>
                {frameCount}&thinsp;f
              </span>
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default RecordingControls;
