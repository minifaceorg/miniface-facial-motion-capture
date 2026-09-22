/*
 * Copyright (c) 2025 Pooya Moradi M. poamrd@gmail.com https://github.com/PooyaDeperson
 * Licensed under the MIT License with Attribution.
 */

/**
 * usePlaybackAnimation.ts
 *
 * Drives an avatar's bones and morph-targets by replaying a GLB blob that was
 * previously exported by buildAndExportGLB(). Loaded entirely in-memory via
 * THREE's GLTFLoader — no network request needed.
 *
 * Features
 * ────────
 * • Play / pause
 * • Always-loop (loop is permanently on)
 * • Scrubber (seek to any normalised position 0–1, works while paused)
 * • Auto-play on blob change
 * • Exposes current time and duration for UI
 * • Cleans up mixer on unmount or blob change
 */

import { useEffect, useRef, useCallback } from "react";
import { AnimationMixer, AnimationClip, Object3D, PropertyBinding } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { useFrame } from "@react-three/fiber";

/**
 * Remove animation tracks that target a node which does not exist in the
 * skeleton we're about to play onto.
 *
 * Recorded GLBs can contain tracks for leaf/tail helper bones (e.g.
 * "HeadTop_End_end", "LeftEye_end", "LeftHandThumb4_end"). Whether those nodes
 * exist depends on which rig/exporter produced the clip, so an old or
 * cross-rig recording will reference bones the current character doesn't have.
 * THREE.AnimationMixer resolves every track against the root when an action is
 * activated; each unresolved track fires a "THREE.PropertyBinding: No target
 * node found for track" warning. A single recording can carry hundreds of
 * these (position/quaternion/scale per missing bone), flooding the console and
 * stalling playback.
 *
 * By resolving each track against the live character scene up front — exactly
 * the way the mixer does internally — and dropping the ones that don't bind, we
 * make playback safe for both new and legacy recordings without touching the
 * stored data.
 */
function stripUnresolvableTracks(clip: AnimationClip, root: Object3D): AnimationClip {
  const resolvable = clip.tracks.filter((track) => {
    try {
      const { nodeName } = PropertyBinding.parseTrackName(track.name);
      return Boolean(PropertyBinding.findNode(root, nodeName));
    } catch {
      return false;
    }
  });

  if (resolvable.length === clip.tracks.length) return clip;
  return new AnimationClip(clip.name, clip.duration, resolvable);
}

export interface PlaybackState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  loop: boolean;
}

export interface PlaybackControls {
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  seek: (normalised: number) => void;
  setLoop: (loop: boolean) => void;
}

// ─── pub/sub for React UI outside the Canvas ─────────────────────────────────

type PlaybackListener = (state: PlaybackState) => void;

// Module-level so RecordingControls / PlaybackControls components can subscribe
// without needing React context through the Canvas boundary.
const _playbackListeners = new Set<PlaybackListener>();
let _playbackState: PlaybackState = {
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  loop: true,
};

function _notifyPlayback() {
  _playbackListeners.forEach((fn) => fn({ ..._playbackState }));
}

export function subscribePlaybackState(fn: PlaybackListener): () => void {
  _playbackListeners.add(fn);
  fn({ ..._playbackState }); // immediate snapshot
  return () => _playbackListeners.delete(fn);
}

export function getPlaybackState(): PlaybackState {
  return { ..._playbackState };
}

// ─── hook ─────────────────────────────────────────────────────────────────────

interface UsePlaybackAnimationOptions {
  /** The character scene whose bones will be driven. */
  characterScene: Object3D | null;
  /** The GLB blob to replay. Pass null to stop playback entirely. */
  playbackBlob: Blob | null;
  /** Bone names owned by secondary motion that the mixer must not touch. */
  excludeBoneNames?: Set<string>;
}

export function usePlaybackAnimation({
  characterScene,
  playbackBlob,
  excludeBoneNames,
}: UsePlaybackAnimationOptions): PlaybackControls {
  const mixerRef    = useRef<AnimationMixer | null>(null);
  const actionRef   = useRef<ReturnType<AnimationMixer["clipAction"]> | null>(null);
  const clipRef     = useRef<AnimationClip | null>(null);
  const loopRef     = useRef(true);

  // Tear down the current mixer and action
  const destroyMixer = useCallback(() => {
    if (actionRef.current) {
      actionRef.current.stop();
      actionRef.current = null;
    }
    if (mixerRef.current) {
      mixerRef.current.stopAllAction();
      mixerRef.current = null;
    }
    clipRef.current = null;
    _playbackState = { isPlaying: false, currentTime: 0, duration: 0, loop: loopRef.current };
    _notifyPlayback();
  }, []);

  // Load the blob and create the mixer
  useEffect(() => {
    if (!characterScene || !playbackBlob) {
      destroyMixer();
      return;
    }

    let cancelled = false;

    const loader = new GLTFLoader();
    const objectUrl = URL.createObjectURL(playbackBlob);

    loader.load(
      objectUrl,
      (gltf) => {
        URL.revokeObjectURL(objectUrl);
        if (cancelled) return;

        destroyMixer();

        let clip = gltf.animations[0];
        if (!clip) return;

        // Strip spring-bone tracks so the mixer does not fight secondary motion
        if (excludeBoneNames && excludeBoneNames.size > 0) {
          const filtered = clip.tracks.filter((t) => {
            const dotIdx = t.name.lastIndexOf(".");
            const withoutProp = dotIdx !== -1 ? t.name.slice(0, dotIdx) : t.name;
            const pipeIdx = withoutProp.lastIndexOf("|");
            const afterPipe = pipeIdx !== -1 ? withoutProp.slice(pipeIdx + 1) : withoutProp;
            const bracketMatch = afterPipe.match(/\.bones\[(.+)\]/);
            const finalName = bracketMatch ? bracketMatch[1] : afterPipe;
            return !excludeBoneNames.has(finalName);
          });
          clip = new AnimationClip(clip.name, clip.duration, filtered);
        }

        // Drop tracks whose target bone is absent from THIS character's
        // skeleton. Prevents the "No target node found for track" warning
        // flood (and resulting playback stall) for recordings made against a
        // different / older rig. Works for both new and legacy motion data.
        clip = stripUnresolvableTracks(clip, characterScene);

        clipRef.current = clip;

        const mixer = new AnimationMixer(characterScene);
        mixerRef.current = mixer;

        const action = mixer.clipAction(clip);
        action.setLoop(
          loopRef.current
            ? (2201 as any) /* THREE.LoopRepeat */
            : (2200 as any) /* THREE.LoopOnce */,
          loopRef.current ? Infinity : 1
        );
        action.play();
        actionRef.current = action;

        _playbackState = {
          isPlaying: true,
          currentTime: 0,
          duration: clip.duration,
          loop: loopRef.current,
        };
        _notifyPlayback();
      },
      undefined,
      (err) => {
        URL.revokeObjectURL(objectUrl);
        console.error("[playback] GLTFLoader error:", err);
      }
    );

    return () => {
      cancelled = true;
      URL.revokeObjectURL(objectUrl);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterScene, playbackBlob]);

  // Clean up on unmount
  useEffect(() => () => destroyMixer(), [destroyMixer]);

  // Per-frame update
  useFrame((_, delta) => {
    const mixer = mixerRef.current;
    const action = actionRef.current;
    const clip = clipRef.current;
    if (!mixer || !action || !clip) return;

    if (_playbackState.isPlaying) {
      mixer.update(delta);

      // Read time from action.time (mod clip.duration for looping) — this
      // stays correct after a seek because we set action.time directly.
      const t = action.time % (clip.duration || 1);
      _playbackState.currentTime = t;
      _notifyPlayback();

      // If loop=false and we've reached the end, pause at last frame
      if (!loopRef.current && action.time >= clip.duration) {
        action.paused = true;
        _playbackState.isPlaying = false;
        _playbackState.currentTime = clip.duration;
        _notifyPlayback();
      }
    }
  });

  // ── controls ────────────────────────────────────────────────────────────────

  const play = useCallback(() => {
    const action = actionRef.current;
    if (!action) return;
    action.paused = false;
    if (!action.isRunning()) action.play();
    _playbackState = { ..._playbackState, isPlaying: true };
    _notifyPlayback();
  }, []);

  const pause = useCallback(() => {
    const action = actionRef.current;
    if (!action) return;
    action.paused = true;
    _playbackState = { ..._playbackState, isPlaying: false };
    _notifyPlayback();
  }, []);

  const togglePlay = useCallback(() => {
    if (_playbackState.isPlaying) pause();
    else play();
  }, [play, pause]);

  const seek = useCallback((normalised: number) => {
    const mixer = mixerRef.current;
    const action = actionRef.current;
    const clip = clipRef.current;
    if (!mixer || !action || !clip) return;

    const t = Math.max(0, Math.min(1, normalised)) * clip.duration;

    // Temporarily un-pause so mixer.update(0) actually evaluates this action
    // (Three.js skips paused actions during update). We do NOT call
    // mixer.setTime() because it internally calls update(0) while the action
    // may still be paused, producing no pose change and corrupting mixer.time.
    const wasPaused = action.paused;
    action.paused = false;

    // Reset the action to the target time and flush — update(0) with a clean
    // action time correctly repositions bones / morph-targets.
    action.time = t;
    mixer.update(0);

    // Re-apply paused state without moving time further.
    action.paused = wasPaused;

    _playbackState = { ..._playbackState, currentTime: t };
    _notifyPlayback();
  }, []);

  const setLoop = useCallback((loop: boolean) => {
    loopRef.current = loop;
    const action = actionRef.current;
    if (action) {
      action.setLoop(
        loop ? (2201 as any) : (2200 as any),
        loop ? Infinity : 1
      );
      action.clampWhenFinished = !loop;
    }
    _playbackState = { ..._playbackState, loop };
    _notifyPlayback();
  }, []);

  return { play, pause, togglePlay, seek, setLoop };
}
