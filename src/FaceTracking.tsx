/*
 * Copyright (c) 2025 Pooya Moradi M. poamrd@gmail.com https://github.com/PooyaDeperson
 * Licensed under the MIT License with Attribution.
 *
 * Permission is hereby granted, free of charge, to use, copy, modify, merge,
 * publish, and distribute this software, provided that the following credit
 * is included in any derivative or distributed version:
 * "Created by Pooya Moradi M. poamrd@gmail.com https://github.com/PooyaDeperson"
 */

// FaceTracking.tsx
// Thin host: owns the <video> element, pumps frames to faceWorker.js via
// createImageBitmap → Transferable postMessage, and writes the same module
// globals that Avatar.tsx reads inside its useFrame() hot path.
// All MediaPipe inference now runs on a dedicated worker thread so the main
// thread remains free for React updates and Three.js rendering.

import { useEffect, useRef } from "react";
import { Euler, Matrix4 } from "three";

// ─── Module globals — same public API as before ───────────────────────────────
// Avatar.tsx reads these directly from the module scope inside useFrame().
// The worker host writes into them from the onmessage handler, still on the
// main thread, so there are no synchronisation issues.

export let blendshapes: any[] = [];
export let rotation: Euler = new Euler();
export let headMesh: any[] = [];

/**
 * The raw Matrix4 from MediaPipe's facial transformation matrix (desktop only).
 * Avatar.tsx uses this to extract a Quaternion for slerp smoothing.
 * Null on mobile (outputFacialTransformationMatrixes is disabled there).
 */
export let headMatrix: Matrix4 | null = null;

/**
 * True when the landmark-based rotation fallback is active (mobile path).
 * Avatar.tsx uses this to choose Euler→Quaternion vs Matrix4 decomposition.
 */
export let isMobileTracking = false;

/** True while the worker is actively delivering detection results. */
export let isMediaPipeActive = false;

/**
 * Immediately clears all hand-tracking globals (finger bones, wrist positions).
 * Called by useMotionRecorder when recording stops so the avatar's RestPoseSmoother
 * starts returning arms/fingers to A-pose on the very next frame, rather than
 * waiting for the user to physically move their hands out of the webcam frame.
 */
export function clearHandTracking(): void {
  leftFingerBones = null;
  rightFingerBones = null;
  leftWristPos = null;
  rightWristPos = null;
}

// ─── Finger bone globals ──────────────────────────────────────────────────────
// Each digit has 4 bones (e.g. LeftHandIndex1–4). Each value is
// [x, y, z, w] quaternion or null when no hand is detected.
// These are read by Avatar.tsx in the useFrame hot path.

export type FingerQuats = {
  Wrist: [number, number, number, number] | null;
  Thumb1: [number, number, number, number] | null;
  Thumb2: [number, number, number, number] | null;
  Thumb3: [number, number, number, number] | null;
  Index1: [number, number, number, number] | null;
  Index2: [number, number, number, number] | null;
  Index3: [number, number, number, number] | null;
  Middle1: [number, number, number, number] | null;
  Middle2: [number, number, number, number] | null;
  Middle3: [number, number, number, number] | null;
  Ring1: [number, number, number, number] | null;
  Ring2: [number, number, number, number] | null;
  Ring3: [number, number, number, number] | null;
  Pinky1: [number, number, number, number] | null;
  Pinky2: [number, number, number, number] | null;
  Pinky3: [number, number, number, number] | null;
} | null;

export let leftFingerBones: FingerQuats = null;
export let rightFingerBones: FingerQuats = null;

/**
 * Wrist landmark position in MediaPipe normalized image space.
 * x: 0 (left edge) → 1 (right edge)
 * y: 0 (top edge)  → 1 (bottom edge)
 * z: depth, roughly 0 at arm's-length, negative = closer to camera
 * null when the hand is not visible.
 */
export let leftWristPos: [number, number, number] | null = null;
export let rightWristPos: [number, number, number] | null = null;

/**
 * Shoulder→Elbow offset vector in PoseLandmarker world space (metres, hip-origin).
 * Coordinate axes: +X = user's right, +Y = up, +Z = toward camera.
 * null when the corresponding shoulder or elbow landmark has low visibility (<0.4)
 * or when PoseLandmarker is unavailable (e.g. model load failure).
 * Avatar.tsx converts this offset to Three.js world space and uses it as the
 * live elbow hint for the 2-bone IK solver, replacing the hardcoded offset.
 */
export let leftElbowOffset: [number, number, number] | null = null;
export let rightElbowOffset: [number, number, number] | null = null;

// ─── Mobile detection (main thread copy — still needed to choose worker mode) ─

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile|Samsung|Xiaomi|MIUI|HarmonyOS/i.test(
    navigator.userAgent
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface InitProgress {
  stage: "wasm" | "face" | "hand" | "pose" | "done";
  percentage: number;
  label: string;
}

function FaceTracking({
  videoStream,
  onMediapipeReady,
  onInitProgress,
  onInitError,
  disabled,
  isFlipped,
  onStopAnimation,
}: {
  videoStream: MediaStream;
  onMediapipeReady?: () => void;
  onInitProgress?: (progress: InitProgress) => void;
  onInitError?: (message: string) => void;
  onStopAnimation?: () => void;
  disabled?: boolean;
  isFlipped?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const predictLoopRef = useRef<number | null>(null);
  const pendingRef = useRef<boolean>(false); // backpressure: one frame in-flight at a time
  const onMediapipeReadyFiredRef = useRef(false);
  const lastVideoTimeRef = useRef(-1);

  useEffect(() => {
    if (!videoStream) return;

    const vid = videoRef.current;
    if (!vid) return;

    const mobile = isMobileDevice();
    isMobileTracking = mobile;

    // ── Spawn the module-mode worker ─────────────────────────────────────────
    // Webpack 5 (react-scripts 5) supports { type: 'module' } workers natively,
    // which lets faceWorker.js use ESM imports from @mediapipe/tasks-vision
    // instead of relying on importScripts + a CDN UMD bundle.
    // eslint-disable-next-line no-restricted-globals
    const worker = new Worker(new URL("./faceWorker.js", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;

    // ── rAF frame pump ───────────────────────────────────────────────────────
    // Runs on the main thread but does zero inference work. It only:
    //   1. Skips the frame if the previous result hasn't arrived yet (backpressure).
    //   2. Creates a cheap ImageBitmap snapshot of the <video> element.
    //   3. Transfers it zero-copy to the worker.
    // createImageBitmap itself is async but resolves in < 1 ms because the
    // video frame is already decoded in the GPU; the await doesn't block rAF.
    const predict = () => {
      const v = videoRef.current;
      if (!v) {
        predictLoopRef.current = requestAnimationFrame(predict);
        return;
      }

      if (!pendingRef.current && v.currentTime !== lastVideoTimeRef.current) {
        lastVideoTimeRef.current = v.currentTime;

        createImageBitmap(v).then((bitmap) => {
          // Only send if the worker is still alive (component not yet unmounted)
          if (!workerRef.current) {
            bitmap.close();
            return;
          }
          pendingRef.current = true;
          workerRef.current.postMessage(
            { type: "DETECT", bitmap, timestamp: performance.now() },
            [bitmap] // transfer ownership — zero-copy, no structured-clone serialisation
          );
        });
      }

      predictLoopRef.current = requestAnimationFrame(predict);
    };

    // ── Worker message handler ────────────────────────────────────────────────
    worker.onmessage = (e: MessageEvent) => {
      const { type } = e.data;

      if (type === "INIT_PROGRESS") {
        if (onInitProgress) {
          onInitProgress({
            stage: e.data.stage,
            percentage: e.data.percentage,
            label: e.data.label,
          });
        }
        return;
      }

      if (type === "READY") {
        // Worker has finished initialising MediaPipe — start the rAF loop.
        predictLoopRef.current = requestAnimationFrame(predict);
        return;
      }

      if (type === "RESULT") {
        const { payload } = e.data as {
          payload: {
            blendshapes: any[];
            matrixData: number[] | null;
            eulerData: [number, number, number] | null;
            leftFingers: FingerQuats;
            rightFingers: FingerQuats;
            leftWristPos: [number, number, number] | null;
            rightWristPos: [number, number, number] | null;
            leftElbowOffset: [number, number, number] | null;
            rightElbowOffset: [number, number, number] | null;
          };
        };

        blendshapes = payload.blendshapes;

        if (payload.matrixData) {
          // Desktop path: reconstruct Matrix4 from the flat 16-element array
          headMatrix = new Matrix4().fromArray(payload.matrixData);
          rotation = new Euler().setFromRotationMatrix(headMatrix);
        } else if (payload.eulerData) {
          // Mobile fallback path: reconstruct Euler from the three angles
          headMatrix = null;
          rotation = new Euler(
            payload.eulerData[0],
            payload.eulerData[1],
            payload.eulerData[2]
          );
        }

        // Update finger bone globals — null means hand not visible this frame
        leftFingerBones = payload.leftFingers ?? null;
        rightFingerBones = payload.rightFingers ?? null;
        leftWristPos = payload.leftWristPos ?? null;
        rightWristPos = payload.rightWristPos ?? null;
        // Elbow direction offsets from PoseLandmarker — null when occluded or unavailable
        leftElbowOffset = payload.leftElbowOffset ?? null;
        rightElbowOffset = payload.rightElbowOffset ?? null;

        isMediaPipeActive = true;

        // Fire once on the very first live result — not on model load —
        // so the "Keep Smiling" overlay only clears when tracking is genuinely live.
        if (!onMediapipeReadyFiredRef.current && onMediapipeReady) {
          onMediapipeReadyFiredRef.current = true;
          onMediapipeReady();
        }

        // Allow the next frame to be sent
        pendingRef.current = false;
        return;
      }

      if (type === "DETECT_ERROR") {
        // Per-frame error (e.g. procrustes solver failure on mobile): just unblock
        // the backpressure guard so the loop keeps running.
        pendingRef.current = false;
        return;
      }

      if (type === "ERROR") {
        // Fatal worker init error — log and leave isMediaPipeActive = false so
        // App.tsx's 30 s timeout triggers the fallback UI.
        console.error("[FaceTracking] Worker init error:", e.data.message);
        if (onInitError) onInitError(e.data.message ?? "Failed to load tracker");
        return;
      }
    };

    // ── Boot sequence ─────────────────────────────────────────────────────────
    vid.srcObject = videoStream;
    vid.onloadeddata = () => {
      // On Android, autoplay may be silently blocked even with `muted`.
      vid.play().catch(() => {
        // Non-fatal — the rAF loop will still attempt detection.
      });
      worker.postMessage({ type: "INIT", isMobile: mobile });
    };

    // ── Cleanup ───────────────────────────────────────────────────────────────
    return () => {
      if (predictLoopRef.current !== null) {
        cancelAnimationFrame(predictLoopRef.current);
        predictLoopRef.current = null;
      }
      worker.terminate();
      workerRef.current = null;
      pendingRef.current = false;

      isMediaPipeActive = false;
      headMatrix = null;
      blendshapes = [];
      leftFingerBones = null;
      rightFingerBones = null;
      leftWristPos = null;
      rightWristPos = null;
      leftElbowOffset = null;
      rightElbowOffset = null;
      onMediapipeReadyFiredRef.current = false;
    };
  }, [videoStream]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      id="video"
      className={`flex pos-fixed flex-col camera-feed z-999 w-1 overflow-hidden tb:w-400 br-12 tb:br-24 m-2 p-2 bg-blur ${disabled ? " switcher-disabled" : ""}`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`br-2 br-12 ${isFlipped ? "flipped-x" : ""}`}
        style={{}}
      />
      {onStopAnimation && (
        <button
          type="button"
          className="primary-button camera-preview-stop"
          onClick={onStopAnimation}
        >
          stop animation
        </button>
      )}
    </div>
  );
}

export default FaceTracking;
