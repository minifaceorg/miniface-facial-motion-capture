/*
 * Copyright (c) 2025 Pooya Moradi M. poamrd@gmail.com https://github.com/PooyaDeperson
 * Licensed under the MIT License with Attribution.
 *
 * Permission is hereby granted, free of charge, to use, copy, modify, merge,
 * publish, and distribute this software, provided that the following credit
 * is included in any derivative or distributed version:
 * "Created by Pooya Moradi M. poamrd@gmail.com https://github.com/PooyaDeperson"
 */

/**
 * useMotionRecorder.ts
 *
 * Module-level singleton that records per-frame blendshape scores and bone
 * rotations from MediaPipe, then builds a Three.js AnimationClip and exports
 * it embedded inside the avatar's original GLTF scene as a binary .glb file.
 *
 * Design notes
 * ─────────────
 * • Module-level mutable state (same pattern as FaceTracking's blendshapes /
 *   rotation / headMesh globals) lets Avatar.tsx read isRecording and write
 *   frames inside useFrame() without any React overhead on the hot path.
 * • React components subscribe via subscribeRecorder() and receive lightweight
 *   state snapshots via getRecorderState() to drive UI.
 * • The export function builds separate tracks for every morph target that had
 *   at least one non-zero score, plus QuaternionKeyframeTrack entries for the
 *   three driven bones (Head, Neck, Spine2).  All other bones / joints are
 *   included in the exported scene at their bind pose.
 */

import {
  Group,
  Euler,
  Quaternion,
  AnimationClip,
  NumberKeyframeTrack,
  QuaternionKeyframeTrack,
  Mesh,
} from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter";
import { createHeadChainQuats, resolveHeadChain } from "./headChainTuning";
import type { SecondaryMotionSystem } from "./SecondaryMotionSystem";
import { clearHandTracking } from "./FaceTracking";
import type { FingerQuats } from "./FaceTracking";

// ─── playback notification (module-level) ─────────────────────────────────────
// After a successful export App.tsx needs the GLB blob + a generated ID so it
// can enter playback mode and open the motion library. We use a pub/sub pattern
// identical to subscribeRecorder so nothing crosses the Canvas boundary.

export interface PlaybackReadyPayload {
  blob: Blob;
  motionId: string;
  name: string;
  durationSeconds: number;
  /** The avatar URL that was active when this motion was recorded */
  avatarUrl?: string;
}

type PlaybackListener = (payload: PlaybackReadyPayload) => void;
const _playbackListeners = new Set<PlaybackListener>();

export function subscribePlaybackReady(fn: PlaybackListener): () => void {
  _playbackListeners.add(fn);
  return () => _playbackListeners.delete(fn);
}

function _notifyPlaybackReady(payload: PlaybackReadyPayload) {
  _playbackListeners.forEach((fn) => fn(payload));
}

/** Generate a short unique ID for a motion. */
function _makeMotionId(): string {
  return `motion_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ─── types ───────────────────────────────────────────────────────────────────

export interface MotionFrame {
  /** Seconds since recording started */
  t: number;
  /** Blendshape categoryName → score (0–1) */
  blendshapes: Record<string, number>;
  /** Raw head Euler (x, y, z) from MediaPipe transformation matrix */
  headEuler: [number, number, number];
  /**
   * Secondary motion bone quaternions snapshotted after spring update.
   * boneName → [x, y, z, w]. Only present when a SecondaryMotionSystem is
   * registered; omitted entirely when no secondary chains are active.
   */
  secondaryBones?: Record<string, [number, number, number, number]>;
  /** Finger bone quaternions for left/right hand. Null when hand not visible. */
  leftFingers?:  FingerQuats;
  rightFingers?: FingerQuats;
  /**
   * Direct bone.quaternion snapshots for bones whose final animated value
   * CANNOT be reconstructed by the exporter from the other MotionFrame fields.
   * Snapshotted in Avatar.tsx AFTER all animation is applied (IK, twist,
   * finger composition, RestPoseSmoother). Keyed by exact bone name.
   *
   * Currently includes:
   *   • LeftArm, LeftForeArm, RightArm, RightForeArm  — arm IK chain
   *   • LeftHand, RightHand                            — world→local + counter-twist
   *   • LeftHandThumb1-3, RightHandThumb1-3            — restLocal × splay × bend
   *
   * Absent on frames where the corresponding hand was not detected.
   */
  armBones?: Record<string, [number, number, number, number]>;
}

export interface RecorderState {
  isRecording: boolean;
  /** True once at least 2 frames have been captured and recording is stopped */
  hasFrames: boolean;
  frameCount: number;
  /** Seconds: elapsed while recording, total duration when stopped */
  duration: number;
}

// ─── module-level state ───────────────────────────────────────────────────────

let _isRecording = false;
let _frames: MotionFrame[] = [];
let _startTime = 0;
let _finalDuration = 0; // stored when recording stops

/** Maximum duration for a single motion capture recording. */
export const MAX_RECORDING_SECONDS = 30;

/** Cached blob from the last stopRecording() build — reused by buildAndExportGLB */
// eslint-disable-next-line prefer-const
let _cachedBlob: { blob: Blob; name: string } | null = null;

/** The GLTF scene Group set by Avatar.tsx so the exporter can walk it */
let _scene: Group | null = null;
/** All named nodes from useGraph, keyed by node.name */
let _nodes: Record<string, any> | null = null;
/** Meshes that carry morphTargetDictionary (Wolf3D_Head, Wolf3D_Teeth, etc.) */
let _headMeshes: Mesh[] = [];
/** The avatar URL that was active when setSceneForExport was last called */
let _avatarUrl: string | null = null;
/**
 * Bind-pose quaternions for every hand/arm bone, captured at setSceneForExport()
 * time when the skeleton is guaranteed to be in its rest pose (before any live
 * tracking has touched the bones). Used as the authoritative "no hand visible"
 * fallback when building GLB tracks, instead of the live bone.quaternion value
 * which may be mid-animation at export time.
 */
let _bindPoseQuats: Record<string, [number, number, number, number]> = {};
/**
 * Optional secondary motion system. When set, its bone quaternions are
 * snapshotted every frame and baked into the exported AnimationClip.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let _secondarySystem: SecondaryMotionSystem | null = null;

// ─── pub/sub ─────────────────────────────────────────────────────────────────

type Listener = () => void;
const _listeners = new Set<Listener>();

function _notify() {
  _listeners.forEach((fn) => fn());
}

/**
 * Subscribe a callback to recorder state changes.
 * Returns an unsubscribe function.
 */
export function subscribeRecorder(fn: Listener): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

// ─── recording-start pub/sub ──────────────────────────────────────────────────
// Avatar.tsx subscribes to this to reset arm/finger smoothers and elbow hints
// the moment a new recording begins. This prevents stale smoother state from a
// prior live session from producing wrong poses in the first few captured frames.

const _startListeners = new Set<Listener>();

export function subscribeRecordingStart(fn: Listener): () => void {
  _startListeners.add(fn);
  return () => _startListeners.delete(fn);
}

function _notifyStart() {
  _startListeners.forEach((fn) => fn());
}

// ���── scene reference (called from Avatar.tsx) ─────────────��───────────────────

/**
 * Avatar.tsx calls this in useEffect whenever the GLTF scene loads / reloads.
 * We store references to the live scene objects so the exporter can use them
 * without needing to traverse the R3F tree from outside the Canvas.
 * avatarUrl is stored so it can be embedded in the exported GLB extras.
 */
// Bone names whose bind-pose quaternion we snapshot at scene-load time.
// These are the bones that can be animated by hand tracking; their fallback
// value when the hand is not visible must be the bind pose, not whatever
// the live skeleton happens to be at GLB-export time.
const HAND_ARM_BONE_NAMES = [
  "LeftArm", "LeftForeArm", "LeftHand",
  "LeftHandThumb1", "LeftHandThumb2", "LeftHandThumb3",
  "RightArm", "RightForeArm", "RightHand",
  "RightHandThumb1", "RightHandThumb2", "RightHandThumb3",
] as const;

export function setSceneForExport(
  scene: Group,
  nodes: Record<string, any>,
  meshes: Mesh[],
  avatarUrl?: string
): void {
  _scene = scene;
  _nodes = nodes;
  _headMeshes = [...meshes];
  if (avatarUrl) _avatarUrl = avatarUrl;

  // Snapshot the bind-pose quaternion for every hand/arm bone right now,
  // while the skeleton is in its rest pose (before any live tracking runs).
  _bindPoseQuats = {};
  for (const name of HAND_ARM_BONE_NAMES) {
    const bone = nodes[name];
    if (bone?.quaternion) {
      const q = bone.quaternion;
      _bindPoseQuats[name] = [q.x, q.y, q.z, q.w];
    }
  }
}

/**
 * Register (or clear) the active SecondaryMotionSystem.
 * Call with the system instance after useSecondaryMotion creates it, and with
 * null when the avatar unmounts or chains become empty.
 */
export function setSecondaryMotionSystem(
  system: SecondaryMotionSystem | null
): void {
  _secondarySystem = system;
}

// ─── state read ───────────────────────────────────────────────────────────────

export function getRecorderState(): RecorderState {
  const now = _isRecording
    ? (performance.now() - _startTime) / 1000
    : _finalDuration;

  return {
    isRecording: _isRecording,
    hasFrames: !_isRecording && _frames.length >= 2,
    frameCount: _frames.length,
    duration: now,
  };
}

// ─── recording controls ───────────────────────────────────────────────────�����───

// ─── beforeunload guard ───────────────────────────────────────────────────────
// Prevent the user from accidentally losing an in-progress recording by
// refreshing (F5 / Ctrl+R), closing the tab, or navigating away. The native
// browser dialog fires immediately — no custom message is shown in modern
// browsers, but the prompt is enough to let the user cancel the action.

function _onBeforeUnload(e: BeforeUnloadEvent) {
  e.preventDefault();
  // Setting returnValue is still required to trigger the dialog in some
  // environments (older Chrome, Electron wrappers, etc.).
  e.returnValue =
    "A recording is in progress. Leaving now will discard it. Are you sure?";
  return e.returnValue;
}

function _addUnloadGuard() {
  window.addEventListener("beforeunload", _onBeforeUnload);
}

function _removeUnloadGuard() {
  window.removeEventListener("beforeunload", _onBeforeUnload);
}

export function startRecording(): void {
  if (_isRecording) return;
  _frames = [];
  _finalDuration = 0;
  _startTime = performance.now();
  _isRecording = true;
  _addUnloadGuard();

  // Clear any stale hand-tracking globals immediately so Avatar.tsx's smoothers
  // don't carry over a mid-gesture pose from the moments before recording began.
  // This ensures the first captured frame reflects what MediaPipe delivers on the
  // very next animation tick, not whatever residue was left by earlier live tracking.
  clearHandTracking();

  // Notify Avatar.tsx (and any other subscribers) that a new recording has
  // started so they can reset arm/finger smoothers and elbow hint state.
  _notifyStart();

  _notify();
}

export function stopRecording(): void {
  if (!_isRecording) return;
  _isRecording = false;
  _removeUnloadGuard();
  _finalDuration = (performance.now() - _startTime) / 1000;

  // Immediately clear hand-tracking globals so Avatar.tsx's RestPoseSmoother
  // starts returning arms/fingers to A-pose on the next frame — prevents the
  // hand pose from staying frozen in the live view after recording ends.
  clearHandTracking();

  _notify();

  // Immediately build the GLB blob in memory so playback can start right away,
  // before the user clicks "save .glb". This is non-blocking — errors are
  // swallowed silently here; the Save button will surface them if needed.
  if (_frames.length >= 2) {
    const timestamp = new Date()
      .toISOString()
      .slice(0, 19)
      .replace("T", "_")
      .replace(/:/g, "-");
    const fileName = `miniface.org_${timestamp}.glb`;
    const snapshotAvatarUrl = _avatarUrl ?? undefined;
    buildGLBBlob()
      .then(({ blob, durationSeconds }) => {
        const motionId = _makeMotionId();
        _cachedBlob = { blob, name: fileName };
        _notifyPlaybackReady({ blob, motionId, name: fileName, durationSeconds, avatarUrl: snapshotAvatarUrl });
      })
      .catch((err) => {
        console.warn("[recorder] Playback blob build failed:", err?.message);
      });
  }
}

export function discardRecording(): void {
  _isRecording = false;
  _removeUnloadGuard();
  _frames = [];
  _finalDuration = 0;
  _cachedBlob = null;
  _notify();
}

// ─── hot-path frame capture (called from Avatar.tsx useFrame) ────────────────

/**
 * Called every render frame while isRecording is true.
 * Keeps overhead minimal: one timestamp read and one array push per frame.
 * Notifies subscribers every 30 frames so the UI timer stays responsive.
 */
export function captureFrame(
  currentBlendshapes: Array<{ categoryName: string; score: number }>,
  headEuler: [number, number, number],
  leftFingers?: FingerQuats,
  rightFingers?: FingerQuats,
  armBones?: Record<string, [number, number, number, number]>
): void {
  if (!_isRecording) return;

  const t = Math.min(
    (performance.now() - _startTime) / 1000,
    MAX_RECORDING_SECONDS,
  );

  const bsMap: Record<string, number> = {};
  for (let i = 0; i < currentBlendshapes.length; i++) {
    const bs = currentBlendshapes[i];
    bsMap[bs.categoryName] = bs.score;
  }

  // Snapshot secondary bone quaternions from the spring system this frame.
  // snapshotBoneQuaternions() is cheap — it just reads .quaternion off each bone.
  const secondaryBones = _secondarySystem
    ? _secondarySystem.snapshotBoneQuaternions()
    : undefined;

  _frames.push({
    t,
    blendshapes: bsMap,
    headEuler,
    secondaryBones,
    leftFingers:  leftFingers  ?? undefined,
    rightFingers: rightFingers ?? undefined,
    armBones,
  });

  // Notify UI listeners at ~1 Hz (assuming ~30 fps)
  if (_frames.length % 30 === 0) _notify();

  // Enforce the cap in the capture layer as a safety net. The controls also
  // use the same stop handler on their timer, so the visible UX remains the
  // exact same as a manual stop.
  if (t >= MAX_RECORDING_SECONDS) stopRecording();
}

// ─── export ───────────────────────────────────────────────────────────────────

/**
 * Builds a GLB ArrayBuffer from the captured frames and returns it as a Blob.
 * Does NOT download the file or notify listeners — useful for programmatic use.
 */
export async function buildGLBBlob(): Promise<{ blob: Blob; durationSeconds: number }> {
  // ── guards ──────────────────────────────────────���───────────────────────────
  if (!_scene) {
    throw new Error(
      "No avatar scene is available. Load an avatar before exporting."
    );
  }
  if (_frames.length < 2) {
    throw new Error(
      `Only ${_frames.length} frame(s) were recorded. Record at least a few frames before saving.`
    );
  }

  const scene = _scene;
  const nodes = _nodes!;
  const meshes = _headMeshes;
  const frames = _frames;

  // ── timeline ────────────────────────────────────────────────────────────────
  // Guarantee a non-zero clip duration in case of a very short burst
  let rawTimes = frames.map((f) => f.t);
  if (rawTimes[rawTimes.length - 1] <= 0) {
    rawTimes = rawTimes.map((_, i) => i / 60);
  }
  const times = new Float32Array(rawTimes);

  const tracks: (NumberKeyframeTrack | QuaternionKeyframeTrack)[] = [];

  // ── morph target tracks ─────────────────────────────────────────────────────
  meshes.forEach((mesh: any) => {
    if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;

    const dict: Record<string, number> = mesh.morphTargetDictionary;

    Object.entries(dict).forEach(([shapeName]) => {
      const values = new Float32Array(frames.length);
      let hasMotion = false;

      for (let i = 0; i < frames.length; i++) {
        const v = frames[i].blendshapes[shapeName] ?? 0;
        values[i] = v;
        if (v > 0.001) hasMotion = true;
      }

      // Skip shapes that never moved — keeps the clip lean
      if (!hasMotion) return;

      // GLTFExporter resolves morphTargetInfluences tracks by the shape NAME
      // string (not the numeric index). It internally does:
      //   mesh.morphTargetDictionary[trackName] �� index
      // Passing the index as a number causes "Morph target name not found: N".
      tracks.push(
        new NumberKeyframeTrack(
          `${mesh.name}.morphTargetInfluences[${shapeName}]`,
          times,
          values
        )
      );
    });
  });

  // ── bone rotation tracks ────────────────────────────────────────────────────
  // Uses the same shared head-chain resolver as Avatar.tsx so the exported
  // animation plays back identically to the live preview.
  // The divisors, the constant neck offset and the measured per-bone rotation
  // correction all come from headChainTuning.ts — the same module the live
  // preview in Avatar.tsx uses — so the exported GLB always matches what the
  // user saw while recording.
  const boneConfigs = [
    { key: "Head", pick: (c: ReturnType<typeof createHeadChainQuats>) => c.head },
    { key: "Neck", pick: (c: ReturnType<typeof createHeadChainQuats>) => c.neck },
    { key: "Spine2", pick: (c: ReturnType<typeof createHeadChainQuats>) => c.spine2 },
  ];

  const _headEuler = new Euler();
  const _chain = createHeadChainQuats();

  boneConfigs.forEach(({ key, pick }) => {
    const bone = nodes[key];
    if (!bone) return; // non-standard rig — skip gracefully

    const quatValues = new Float32Array(frames.length * 4);

    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      _headEuler.set(f.headEuler[0], f.headEuler[1], f.headEuler[2], "XYZ");
      resolveHeadChain(_headEuler, _chain);
      const _q = pick(_chain);
      quatValues[i * 4 + 0] = _q.x;
      quatValues[i * 4 + 1] = _q.y;
      quatValues[i * 4 + 2] = _q.z;
      quatValues[i * 4 + 3] = _q.w;
    }

    // GLTFExporter resolves: scene.getObjectByName(bone.name) → quaternion
    tracks.push(
      new QuaternionKeyframeTrack(
        `${bone.name}.quaternion`,
        times,
        quatValues
      )
    );
  });

  // ── secondary motion bone tracks ───────────────────────────────────────────
  // If secondary bone data was captured, build one QuaternionKeyframeTrack per
  // unique bone name. Bones are matched by name in the exported GLTF scene so
  // the playback is identical to what the user saw during recording.
  if (frames.some((f) => f.secondaryBones && Object.keys(f.secondaryBones).length > 0)) {
    // Collect all unique bone names across all frames.
    const boneNames = new Set<string>();
    for (const f of frames) {
      if (f.secondaryBones) {
        for (const name of Object.keys(f.secondaryBones)) {
          boneNames.add(name);
        }
      }
    }

    for (const boneName of Array.from(boneNames)) {
      const quatValues = new Float32Array(frames.length * 4);
      // Use the identity quaternion [0,0,0,1] as fallback for any frame where
      // the bone data is missing (e.g. the first frame before spring init).
      for (let i = 0; i < frames.length; i++) {
        const q = frames[i].secondaryBones?.[boneName];
        quatValues[i * 4 + 0] = q ? q[0] : 0;
        quatValues[i * 4 + 1] = q ? q[1] : 0;
        quatValues[i * 4 + 2] = q ? q[2] : 0;
        quatValues[i * 4 + 3] = q ? q[3] : 1;
      }
      tracks.push(
        new QuaternionKeyframeTrack(
          `${boneName}.quaternion`,
          times,
          quatValues
        )
      );
    }
  }

  // ── direct bone snapshot tracks (arm IK chain) ────────────────────────────
  // LeftArm / LeftForeArm / RightArm / RightForeArm are driven by the IK solver
  // and forearm twist distribution and cannot be reconstructed from any other
  // MotionFrame field. Avatar.tsx snapshots them from bone.quaternion after all
  // animation is applied. Thumb bones are handled in the finger section below.
  const ARM_BONE_NAMES = ["LeftArm", "LeftForeArm", "RightArm", "RightForeArm"] as const;

  for (const boneName of ARM_BONE_NAMES) {
    const bone = nodes[boneName];
    if (!bone) continue; // non-RPM rig — skip

    // Avatar.tsx now snapshots these bones every frame (regardless of whether
    // the hand is visible), so armBones[boneName] is always present. We read
    // the captured value directly — no static bind-pose fallback needed.
    const quatValues = new Float32Array(frames.length * 4);
    const bp = _bindPoseQuats[boneName];
    let hasMotion = false;

    for (let i = 0; i < frames.length; i++) {
      const q = frames[i].armBones?.[boneName];
      if (q) {
        quatValues[i * 4 + 0] = q[0];
        quatValues[i * 4 + 1] = q[1];
        quatValues[i * 4 + 2] = q[2];
        quatValues[i * 4 + 3] = q[3];
        // Motion = any frame that differs from the bind pose by a meaningful amount.
        if (bp) {
          const dx = q[0] - bp[0], dy = q[1] - bp[1],
                dz = q[2] - bp[2], dw = q[3] - bp[3];
          if (dx*dx + dy*dy + dz*dz + dw*dw > 1e-6) hasMotion = true;
        } else {
          hasMotion = true;
        }
      } else {
        // Fallback (should not be reached with the new always-snapshot approach,
        // but kept as a safety net for older recordings or non-RPM rigs).
        if (bp) {
          quatValues[i * 4 + 0] = bp[0];
          quatValues[i * 4 + 1] = bp[1];
          quatValues[i * 4 + 2] = bp[2];
          quatValues[i * 4 + 3] = bp[3];
        } else {
          quatValues[i * 4 + 3] = 1; // identity
        }
      }
    }

    // Skip face-only recordings where the arm never left the bind pose.
    if (!hasMotion) continue;

    tracks.push(
      new QuaternionKeyframeTrack(`${boneName}.quaternion`, times, quatValues)
    );
  }

  // ── finger bone tracks ────────────────────────────────────────────────────���
  // Build QuaternionKeyframeTrack for every finger + wrist bone that had at
  // least one non-identity frame.  We only emit tracks when a hand was seen,
  // so files stay lean for face-only recordings.
  //
  // "Wrist" maps to the Hand bone (LeftHand / RightHand) — no "Hand" suffix.
  const FINGER_KEYS = [
    "Thumb1","Thumb2","Thumb3","Thumb4",
    "Index1","Index2","Index3","Index4",
    "Middle1","Middle2","Middle3","Middle4",
    "Ring1","Ring2","Ring3","Ring4",
    "Pinky1","Pinky2","Pinky3","Pinky4",
  ] as const;

  for (const side of ["Left", "Right"] as const) {
    const frameKey = side === "Left" ? "leftFingers" : "rightFingers";

    // ─��� wrist / Hand bone ──────────────────────────────────────────────────
    // The wrist bone's final local quaternion is:
    //   conjug(halfTwist) × (parentInv × wristWorldQuat)
    // i.e. the raw world-space "Wrist" entry from FingerQuats converted to
    // forearm-local space AND counter-twisted by the 50% forearm twist.
    // Reading fingerData["Wrist"] would give only the unprocessed world-space
    // value — skipping both steps and causing over-twist in the exported GLB.
    // Avatar.tsx snapshots bone.quaternion after all passes into armBones, so
    // we read from there instead.
    const wristBoneName = `${side}Hand`;
    const wristBone = nodes[wristBoneName];
    if (wristBone) {
      const quatValues = new Float32Array(frames.length * 4);
      // Avatar.tsx now snapshots wrist bone every frame, so armBones[wristBoneName]
      // is always present. Use captured value directly.
      const bp = _bindPoseQuats[wristBoneName];
      let hasMotion = false;
      for (let i = 0; i < frames.length; i++) {
        const q = frames[i].armBones?.[wristBoneName];
        if (q) {
          quatValues[i * 4 + 0] = q[0];
          quatValues[i * 4 + 1] = q[1];
          quatValues[i * 4 + 2] = q[2];
          quatValues[i * 4 + 3] = q[3];
          // Motion = differs from bind pose by a meaningful amount.
          if (bp) {
            const dx = q[0]-bp[0], dy = q[1]-bp[1], dz = q[2]-bp[2], dw = q[3]-bp[3];
            if (dx*dx + dy*dy + dz*dz + dw*dw > 1e-6) hasMotion = true;
          } else {
            hasMotion = true;
          }
        } else {
          // Safety fallback for non-RPM rigs or older snapshots.
          if (bp) {
            quatValues[i * 4 + 0] = bp[0];
            quatValues[i * 4 + 1] = bp[1];
            quatValues[i * 4 + 2] = bp[2];
            quatValues[i * 4 + 3] = bp[3];
          } else {
            quatValues[i * 4 + 3] = 1;
          }
        }
      }
      if (hasMotion) {
        tracks.push(new QuaternionKeyframeTrack(`${wristBoneName}.quaternion`, times, quatValues));
      }
    }

    // ── finger joints ──────────────────────────────────────────────────────
    for (const key of FINGER_KEYS) {
      const boneName = `${side}Hand${key}`;
      const bone = nodes[boneName];
      if (!bone) continue; // non-RPM rig — skip

      // Thumb bones are stored in armBones (boneSnapshot) rather than in the
      // raw FingerQuats, because their final skeleton value is a composed
      // product of restLocal × abduction × bend — not just the raw bend
      // quaternion from the worker. Reading the raw FingerQuats entry for a
      // thumb would replay only the bend component and produce the wrong pose.
      // Avatar.tsx snapshots the post-composition bone.quaternion directly into
      // armBones for all three thumb bones on both hands.
      const isThumb = key.startsWith("Thumb");

      const quatValues = new Float32Array(frames.length * 4);
      let hasMotion = false;

      // Thumb bind pose (for motion detection threshold and safety fallback).
      // Non-thumb finger joints have identity bind pose, so [0,0,0,1] is correct.
      const thumbBp = isThumb ? _bindPoseQuats[boneName] : null;

      for (let i = 0; i < frames.length; i++) {
        let q: number[] | null = null;

        if (isThumb) {
          // Avatar.tsx snapshots thumb bones every frame into armBones.
          const snap = frames[i].armBones?.[boneName];
          q = snap ? Array.from(snap) : null;
        } else {
          // Non-thumb: raw FingerQuats entry (identity rest pose, only present
          // when hand is visible).
          const fingerData = frames[i][frameKey];
          q = fingerData ? (fingerData as any)[key] : null;
        }

        if (q) {
          quatValues[i * 4 + 0] = q[0];
          quatValues[i * 4 + 1] = q[1];
          quatValues[i * 4 + 2] = q[2];
          quatValues[i * 4 + 3] = q[3];
          // For thumbs: motion = differs from bind pose. For fingers: any non-identity.
          if (thumbBp) {
            const dx = q[0]-thumbBp[0], dy = q[1]-thumbBp[1],
                  dz = q[2]-thumbBp[2], dw = q[3]-thumbBp[3];
            if (dx*dx + dy*dy + dz*dz + dw*dw > 1e-6) hasMotion = true;
          } else {
            if (Math.abs(q[3]) < 0.9999) hasMotion = true;
          }
        } else {
          // Safety fallback: bind pose for thumbs (always-snapshot means this
          // path should not be reached for thumbs), identity for finger joints.
          quatValues[i * 4 + 0] = thumbBp ? thumbBp[0] : 0;
          quatValues[i * 4 + 1] = thumbBp ? thumbBp[1] : 0;
          quatValues[i * 4 + 2] = thumbBp ? thumbBp[2] : 0;
          quatValues[i * 4 + 3] = thumbBp ? thumbBp[3] : 1;
        }
      }

      if (!hasMotion) continue; // skip bones that never moved

      tracks.push(
        new QuaternionKeyframeTrack(
          `${boneName}.quaternion`,
          times,
          quatValues
        )
      );
    }
  }

  if (tracks.length === 0) {
    throw new Error(
      "No animated tracks were detected. Make sure MediaPipe is tracking before recording."
    );
  }

  // ── build AnimationClip ──────────────────────────────────────────────────
  const clip = new AnimationClip("FacialCapture", -1, tracks);
  const durationSeconds = clip.duration;

  // ── GLTFExporter ────────────────────────────────────────────────────────────
  const exporter = new GLTFExporter();

  // Embed avatarUrl into scene.userData so GLTFExporter writes it into
  // asset.extras in the output GLB (userData is the supported mechanism —
  // the 'extras' option key does not exist on GLTFExporterOptions).
  const prevUserData = scene.userData ? { ...scene.userData } : {};
  if (_avatarUrl) {
    scene.userData = { ...prevUserData, avatarUrl: _avatarUrl };
  }

  const result = await exporter.parseAsync(scene, {
    binary: true,
    animations: [clip],
    onlyVisible: false,
    embedImages: true,
  });

  // Restore scene.userData so we don't pollute the live scene
  scene.userData = prevUserData;

  const buffer = result as ArrayBuffer;
  const blob = new Blob([buffer], { type: "model/gltf-binary" });
  return { blob, durationSeconds };
}

/**
 * Builds a GLB, triggers a browser download, notifies playback subscribers,
 * and (if Drive tokens are present) uploads to Google Drive in the background.
 *
 * This is the function called by RecordingControls on "save .glb".
 */
export async function buildAndExportGLB(): Promise<void> {
  const timestamp = new Date()
    .toISOString()
    .slice(0, 19)
    .replace("T", "_")
    .replace(/:/g, "-");
  const fileName = `facial_capture_${timestamp}.glb`;

  // Re-use the blob already built by stopRecording() if available — avoids a
  // second heavy GLTFExporter pass for the same take.
  let blob: Blob;
  let durationSeconds: number;
  if (_cachedBlob) {
    blob = _cachedBlob.blob;
    durationSeconds = 0; // duration already notified; this path is download-only
  } else {
    const result = await buildGLBBlob();
    blob = result.blob;
    durationSeconds = result.durationSeconds;

    // Notify playback if it hasn't been notified yet (edge case: user skips stop
    // and goes straight to export without the stopRecording async completing)
    const motionId = _makeMotionId();
    _cachedBlob = { blob, name: fileName };
    _notifyPlaybackReady({ blob, motionId, name: fileName, durationSeconds });
  }

  // ── browser download ───────────────────────────────────────────────────────
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);

  // ── notify playback listeners ─────────────────────────────────��────────────
  const motionId = _makeMotionId();
  _notifyPlaybackReady({ blob, motionId, name: fileName, durationSeconds });

  // ── Drive upload (background, non-blocking) ─────────────────────────────────
  // Import lazily to avoid circular deps; graceful fallback if Drive not ready.
  try {
    const { hasDriveAccess, uploadToDrive } = await import("./useDriveSync");
    if (hasDriveAccess()) {
      uploadToDrive(blob, fileName, durationSeconds).catch((err) => {
        console.warn("[recorder] Background Drive upload failed:", err?.message);
      });
    }
  } catch { /* useDriveSync not available */ }
}
