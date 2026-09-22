/*
 * Copyright (c) 2025 Pooya Moradi M. poamrd@gmail.com https://github.com/PooyaDeperson
 * Licensed under the MIT License with Attribution.
 *
 * Permission is hereby granted, free of charge, to use, copy, modify, merge,
 * publish, and distribute this software, provided that the following credit
 * is included in any derivative or distributed version:
 * "Created by Pooya Moradi M. poamrd@gmail.com https://github.com/PooyaDeperson"
 */

import "./App.css";
import { useState, useCallback, useEffect, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import CameraPermissions from "./camera-permission";
import ColorSwitcher from "./components/ColorSwitcher";
import AvatarSwitcher from "./components/AvatarSwitcher";
import RecordingControls from "./components/RecordingControls";
import PlaybackControls from "./components/PlaybackControls";
import MotionLibrary from "./components/MotionLibrary";
import MotionLibraryButton from "./components/MotionLibraryButton";
import FaceTracking from "./FaceTracking";
import type { InitProgress } from "./FaceTracking";
import TrackingLoader from "./components/TrackingLoader";
import AvatarCanvas from "./AvatarCanvas";
import { discardRecording, subscribePlaybackReady } from "./useMotionRecorder";
import AuthButton from "./components/AuthButton";
import AuthModal from "./components/AuthModal";
import PostRecordAuthPopup from "./components/PostRecordAuthPopup";
import LibraryAuthPopup from "./components/LibraryAuthPopup";
import PermissionPopup from "./components/PermissionPopup";
import IconButton from "./components/IconButton";
import { supabase } from "./supabaseClient";
import { hasDriveAccess, clearDriveTokens, listDriveMotions, uploadToDrive, subscribeMotionUploaded, subscribeQuotaExceeded, subscribeNoDriveScope, subscribeUploadFailed, DriveQuotaError, BulkSyncProgress, DRIVE_SCOPE } from "./useDriveSync";
import type { DriveMotionFile } from "./useDriveSync";
import { getAllAvatars, resolveAvatarUrl } from "./avatarMetadata";
import type { User } from "@supabase/supabase-js";
import { getAuthRedirectUrl, rememberAuthReturnUrl, restoreAuthReturnUrl } from "./authRedirect";

function App() {
  useEffect(() => {
    document.title = "miniface for vtubers | Animate Your Streamer Avatar";
    const description = "Animate your VTuber avatar with miniface for vtubers. Capture face and finger motion in real time with browser-based tracking for streams and virtual performances.";
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "description");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", description);
  }, []);

  const [url, setUrl] = useState<string | null>(null);
  const [avatarKey, setAvatarKey] = useState(0);
  const [avatarReady, setAvatarReady] = useState(false);
  const [motionLoading, setMotionLoading] = useState(false);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [mediapipeReady, setMediapipeReady] = useState(false);
  const [initProgress, setInitProgress] = useState<InitProgress | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [recordingPhase, setRecordingPhase] = useState<"idle" | "recording" | "review" | "done">("idle");
  const [isFlipped, setIsFlipped] = useState(true);
  const [animationStarted, setAnimationStarted] = useState(false);

  // ── Playback state ────────────────────────────────────────────────────────
  const [playbackBlob, setPlaybackBlob] = useState<Blob | null>(null);
  const [activeMotionId, setActiveMotionId] = useState<string | null>(null);
  const [activeMotionName, setActiveMotionName] = useState<string | undefined>(undefined);

  // ── Motion Library state ──────────────────────────────────────────────────
  const [libraryOpen, setLibraryOpen] = useState(false);
  /** True during the 220ms slide-out so the panel can animate before unmounting */
  const [libraryClosing, setLibraryClosing] = useState(false);
  /** True while the motion library button has been clicked — replaces it with the live button */
  const [libraryButtonActive, setLibraryButtonActive] = useState(false);
  const [libraryMotionCount, setLibraryMotionCount] = useState(0);
  const [bulkProgress] = useState<BulkSyncProgress | null>(null);
  /** Incremented after a successful upload to trigger a background re-fetch */
  const [libraryRefreshKey, setLibraryRefreshKey] = useState(0);
  /** Optimistic motion shown immediately after upload, before Drive re-fetch */
  const [pendingMotion, setPendingMotion] = useState<import("./useDriveSync").DriveMotionFile | null>(null);

  // ── Drive upload status — shown in RecordingControls review overlay ─────────
  const [driveUploadStatus, setDriveUploadStatus] = useState<
    "idle" | "uploading" | "done" | "error" | "quota"
  >("idle");

  // ── Auth modal trigger — can be fired from MotionLibrary when not logged in ──
  const [showAuthModal, setShowAuthModal] = useState(false);

  // ── Post-record auth popup — shown to guests after a recording stops ──────
  const [showPostRecordAuthPopup, setShowPostRecordAuthPopup] = useState(false);

  // ── Library auth popup — shown to guests when they click the library button ──
  const [showLibraryAuthPopup, setShowLibraryAuthPopup] = useState(false);

  // ── No Drive access — signed in but Drive scope missing ──────────────────
  // Lifted from MotionLibrary so the popup is always visible, even when the
  // library panel is closed.
  const [noDriveAccessDetected, setNoDriveAccessDetected] = useState(false);
  const [driveDisconnecting, setDriveDisconnecting] = useState(false);

  /** Directly triggers Google OAuth with Drive scope — skips the AuthModal. */
  const handleGoogleReAuth = useCallback(async () => {
    if (!supabase) return;
    rememberAuthReturnUrl();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: getAuthRedirectUrl(),
        skipBrowserRedirect: false,
        scopes: DRIVE_SCOPE,
          queryParams: {
          access_type: "offline",
          prompt: "consent",
          // Prevent this re-auth flow from replacing previously granted scopes.
          include_granted_scopes: "true",
        },
      },
    });
  }, []);

  /** Signs the user out from the persistent missing-Drive-permission popup. */
  const handleDriveDisconnect = useCallback(async () => {
    if (!supabase) return;
    setDriveDisconnecting(true);
    clearDriveTokens();
    await supabase.auth.signOut();
    window.location.reload();
  }, []);

  // ── Drive scope state (drive token can appear after sign-in redirect) ─────
  const [hasDrive, setHasDrive] = useState(() => hasDriveAccess());

  // ── Single authoritative user state ──────────────────────────────────────
  // Tracked here at the App level so AuthButton and AuthModal both receive the
  // same already-resolved user — eliminating the async flash in AuthModal where
  // it would render the signed-out view for a frame before getSession resolved.
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  useEffect(() => {
    if (!currentUser) {
      setAnimationStarted(false);
    }
  }, [currentUser]);

  useEffect(() => {
    if (!supabase) return;
    // Seed immediately from the existing session (sync in Supabase JS v2).
    supabase.auth.getSession().then(({ data }) => {
      setCurrentUser(data.session?.user ?? null);
      // Supabase must consume the OAuth hash before we restore the original
      // route; otherwise replacing the URL first discards access_token.
      restoreAuthReturnUrl();
    });
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUser(session?.user ?? null);
    });
    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  // Poll for Drive access after component mounts (handles OAuth redirect case)
  useEffect(() => {
    const check = () => setHasDrive(hasDriveAccess());
    // Check once on mount and again after short delays (post-redirect token store)
    check();
    const t1 = setTimeout(check, 500);
    const t2 = setTimeout(check, 1500);
    const t3 = setTimeout(check, 3000);
    // Also re-check whenever the tab regains focus (user completes OAuth in another tab)
    window.addEventListener("focus", check);
    // Re-check on sessionStorage changes (storeDriveTokens writes here)
    window.addEventListener("storage", check);
    // Custom event covers same-tab token writes; native storage events do not.
    window.addEventListener("miniface:drive-token", check);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      window.removeEventListener("focus", check);
      window.removeEventListener("storage", check);
      window.removeEventListener("miniface:drive-token", check);
    };
  }, []);

  // ── Immediately detect missing Drive scope after login ───────────────────
  // We run a single definitive check after mount: if Supabase has an active
  // session but no Drive token is in sessionStorage, the user skipped the
  // Drive scope and should see the persistent popup immediately.
  // We deliberately do NOT subscribe to onAuthStateChange here — supabaseClient
  // already fires notifyNoDriveScope for fresh sign-ins (handled below). This
  // effect only handles users who reload the page while already logged-in but
  // without Drive access.
  useEffect(() => {
    if (!supabase) return;

    // Small delay so Supabase can finish restoring the session and
    // storeDriveTokens (triggered by supabaseClient.ts) can write to
    // sessionStorage before we read it.
    const t = setTimeout(async () => {
      const { data } = await supabase!.auth.getSession();
      const loggedIn = !!data.session?.user;
      const hasToken = hasDriveAccess();
      if (loggedIn && !hasToken) {
        setNoDriveAccessDetected(true);
      }
    }, 800);

    return () => clearTimeout(t);
  }, []); // runs once on mount only

  // When Drive access is confirmed, clear the no-drive popup
  useEffect(() => {
    if (hasDrive) setNoDriveAccessDetected(false);
  }, [hasDrive]);

  // When Drive access becomes available, fetch motion count for the badge
  useEffect(() => {
    if (!hasDrive) {
      setLibraryMotionCount(0);
      return;
    }
    listDriveMotions()
      .then((files) => setLibraryMotionCount(files.length))
      .catch((err: any) => {
        const msg: string = err?.message ?? "";
        const is403 =
          msg.includes("403") ||
          msg.toLowerCase().includes("insufficient") ||
          msg.toLowerCase().includes("permission_denied");
        if (is403) {
          // Stale token — clear it and surface the no-drive popup
          clearDriveTokens();
          setHasDrive(false);
          setNoDriveAccessDetected(true);
        }
        // badge stays 0 for all other errors
      });
  }, [hasDrive]);

  // ── Pending playback — used when avatar swap is required before playing ─────
  // When the user selects a library motion recorded on a different avatar, we
  // first swap the avatar (which triggers a load + skeleton loader), and once
  // avatarReady fires we pick this up and start playback.
  const pendingPlaybackRef = useRef<{ blob: Blob; file: DriveMotionFile } | null>(null);
  const latestPlaybackRef = useRef<{ blob: Blob; name: string } | null>(null);

  // Timeout fallback: if face detection never fires within 30s on mobile,
  // dismiss the overlay so the user isn't permanently stuck.
  const mediapipeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSwitcherDisabled = recordingPhase !== "idle";

  const handlePhaseChange = useCallback((phase: "idle" | "recording" | "review" | "done") => {
    setRecordingPhase(phase);
  }, []);

  const handleStreamReady = (stream: MediaStream) => {
    setMediapipeReady(false);
    setInitProgress(null);
    setInitError(null);
    setVideoStream(stream);
  };

  const handleMediapipeReady = useCallback(() => {
    if (mediapipeTimeoutRef.current) {
      clearTimeout(mediapipeTimeoutRef.current);
      mediapipeTimeoutRef.current = null;
    }
    setMediapipeReady(true);
  }, []);

  // Start the fallback timeout only after the authenticated user explicitly
  // starts animation. Camera permission and preview alone must not initialise
  // MediaPipe or trigger model loading.
  useEffect(() => {
    if (currentUser && animationStarted && avatarReady && videoStream && !mediapipeReady) {
      mediapipeTimeoutRef.current = setTimeout(() => {
        setMediapipeReady(true);
      }, 30000);
    }
    return () => {
      if (mediapipeTimeoutRef.current) {
        clearTimeout(mediapipeTimeoutRef.current);
        mediapipeTimeoutRef.current = null;
      }
    };
  }, [currentUser, animationStarted, avatarReady, videoStream, mediapipeReady]);

  const handleAvatarChange = (newUrl: string, keepPending = false) => {
    discardRecording();
    // Clear any pending playback unless this swap is itself triggered by a
    // library selection (keepPending = true), in which case the ref was just
    // set by handleSelectMotion and must survive into the avatarReady effect.
    if (!keepPending) {
      pendingPlaybackRef.current = null;
    }

    useGLTF.clear(newUrl);

    if (url === newUrl) {
      setUrl(null);
      setTimeout(() => {
        setUrl(newUrl);
        setAvatarKey((k) => k + 1);
      }, 0);
    } else {
      setUrl(newUrl);
      setAvatarKey((k) => k + 1);
    }

    setAvatarReady(false);
  };

  // ── Subscribe to playback-ready events from useMotionRecorder ────────────
  useEffect(() => {
    return subscribePlaybackReady(({ blob, motionId, name, durationSeconds, avatarUrl }) => {
      setPlaybackBlob(blob);
      setActiveMotionId(motionId);
      setActiveMotionName(name.replace(/\.glb$/i, ""));
      setDriveUploadStatus("idle"); // reset for this new take

      // Keep ref current so Drive-connect effect can upload if user signs in later
      latestPlaybackRef.current = { blob, name };

      // For logged-in users open the library so they see the motion placed there.
      // For guests, show the post-record auth popup instead (they can open the
      // library manually later via the library button).
      if (hasDriveAccess()) {
        setLibraryOpen(true);
      } else {
        // Only show once per browser session — if the user already dismissed it
        // this session, don't show it again until they reopen the tab.
        const dismissed = sessionStorage.getItem("postRecordAuthPopup_dismissed");
        if (!dismissed) {
          setShowPostRecordAuthPopup(true);
        }
      }

      // Immediately create an optimistic pending motion for ALL users (guest and
      // logged-in) so the row appears in the library without any delay.
      // For logged-in users this row shows a "saving…" spinner until Drive
      // confirms the upload; subscribeMotionUploaded will replace it.
      const optimisticMotion: DriveMotionFile = {
        driveFileId: motionId,
        name: name,
        size: blob.size,
        modifiedTime: new Date().toISOString(),
        duration: durationSeconds,
        avatarUrl: avatarUrl,
      };
      setPendingMotion(optimisticMotion);

      // If already signed in, the Drive upload fires inside stopRecording().
      // Set uploading status immediately and wait for the upload to resolve
      // via the uploadToDrive promise in useMotionRecorder (we listen in a
      // separate effect below). Here we just show the spinner.
      if (hasDriveAccess()) {
        setDriveUploadStatus("uploading");
      }
    });
  }, []);

  // ── Subscribe to Drive quota exceeded events ──────────────────────────────
  // Fires from useDriveSync._notifyQuota() whenever any uploadToDrive() call
  // fails with DriveQuotaError — even the one inside useMotionRecorder.
  useEffect(() => {
    return subscribeQuotaExceeded(() => {
      setDriveUploadStatus("quota");
      setLibraryOpen(true); // open the library so the banner is visible
    });
  }, []);

  // ── Subscribe to sign-in without Drive scope ────────────────────────��─────
  // When the user signs in with Google but does NOT grant Drive appdata access,
  // supabaseClient fires notifyNoDriveScope(). We auto-open the AuthModal so
  // they immediately see the friendly "grant Drive access" prompt. Their
  // pending recording blob is still in latestPlaybackRef and will upload once
  // they successfully grant access and hasDrive becomes true.
  useEffect(() => {
    return subscribeNoDriveScope(() => {
      // Fresh OAuth redirect without Drive scope — show the persistent popup
      // instead of the AuthModal so the user sees the clear Drive-specific message.
      setNoDriveAccessDetected(true);
    });
  }, []);

  // ── Subscribe to Drive upload completions ────��─────────────────────────��──
  // When uploadToDrive() succeeds (from any call site — stopRecording, the
  // hasDrive-transition effect, etc.) we get the DriveMotionFile back and:
  //  1. Replace pendingMotion with the confirmed Drive file (real driveFileId)
  //  2. If the user is still on this motion (activeMotionId matches the optimistic
  //     id), update activeMotionId to the real Drive file ID so selection stays correct
  //  3. Bump libraryRefreshKey → triggers a silent background re-fetch so the
  //     list eventually reflects the canonical Drive order
  //  4. Increment libraryMotionCount for the badge
  //  5. Mark driveUploadStatus as "done"
  useEffect(() => {
    return subscribeMotionUploaded((file) => {
      setPendingMotion(file);
      setActiveMotionId((currentId) => {
        // If the user is still viewing the optimistic motion, point to the real one
        // We can't compare directly since we don't have the optimistic ID here,
        // but if the current ID starts with "motion_" it's the local optimistic one
        if (currentId && currentId.startsWith("motion_")) {
          setActiveMotionName(file.name.replace(/\.glb$/i, ""));
          return file.driveFileId;
        }
        return currentId;
      });
      setLibraryRefreshKey((k) => k + 1);
      setLibraryMotionCount((c) => c + 1);
      setDriveUploadStatus("done");
    });
  }, []);

  // Clear the optimistic pending motion a short while after the refresh fires,
  // giving the library re-fetch time to complete and replace it with real data.
  useEffect(() => {
    if (libraryRefreshKey === 0) return;
    const t = setTimeout(() => setPendingMotion(null), 4000);
    return () => clearTimeout(t);
  }, [libraryRefreshKey]);

  // ── Subscribe to Drive upload failures ───────────────────────────────────
  // uploadToDrive() can be called from useMotionRecorder (where App.tsx has
  // no direct .catch() handle). Without this, a failed upload leaves
  // driveUploadStatus stuck at "uploading" and the pending card stuck in the
  // "saving…" spinner forever. On reload the card is gone and nothing is in
  // Drive — the motion is lost silently.
  useEffect(() => {
    return subscribeUploadFailed((err) => {
      const isAuth = err.name === "DriveAuthError";
      setDriveUploadStatus(isAuth ? "idle" : "error");
      // Clear the stuck optimistic card so the library doesn't show a phantom
      // "saving…" entry that can never resolve.
      setPendingMotion(null);
      if (isAuth) {
        // Token expired mid-upload — clear stale Drive state so the user is
        // prompted to reconnect on their next action.
        setHasDrive(false);
      }
    });
  }, []);

  // ── Playback controls (bridging out of R3F canvas) ──���─────────────────────
  const getPlaybackControls = useCallback(() =>
    (window as any).__playbackControls ?? null,
    []);

  const handleTogglePlay = useCallback(() => {
    getPlaybackControls()?.togglePlay();
  }, [getPlaybackControls]);

  const handleSeek = useCallback((t: number) => {
    getPlaybackControls()?.seek(t);
  }, [getPlaybackControls]);

  const handleSetLoop = useCallback((loop: boolean) => {
    getPlaybackControls()?.setLoop(loop);
  }, [getPlaybackControls]);

  // ── Apply pending playback once the avatar finishes loading ──────────────
  // When a library motion needs a different avatar, handleSelectMotion stores
  // the blob in pendingPlaybackRef and triggers an avatar swap. This effect
  // watches avatarReady and fires as soon as the new mesh is mounted.
  useEffect(() => {
    if (!avatarReady) return;
    const pending = pendingPlaybackRef.current;
    if (!pending) return;
    pendingPlaybackRef.current = null;
    setPlaybackBlob(pending.blob);
    setActiveMotionId(pending.file.driveFileId);
    setActiveMotionName(pending.file.name.replace(/\.glb$/i, ""));
  }, [avatarReady]);

  // ── "Do another" → back to idle, clear playback ───────────────────────────
  // Called by BOTH PlaybackControls (scrubber bar) and RecordingControls.
  const handleDoAnother = useCallback(() => {
  setAnimationStarted(false);
  setPlaybackBlob(null);
    setActiveMotionId(null);
    setActiveMotionName(undefined);
    pendingPlaybackRef.current = null;
    discardRecording();
    handlePhaseChange("idle");
    // Reset mediapipe so "keep smiling" loader shows while it re-initialises
    setMediapipeReady(false);
    // Library stays open so logged-in users can browse their history
  }, [handlePhaseChange]);

  // ── Close library with slide-out animation ───────────────────────────────
  const closeLibrary = useCallback(() => {
    setLibraryClosing(true);
    setTimeout(() => {
      setLibraryOpen(false);
      setLibraryClosing(false);
    }, 230); // matches slide-out-right duration (220ms) + tiny buffer
  }, []);

  // ── Start live capture from inside library panel or player ───────────────
  const handleStartLive = useCallback(() => {
  setAnimationStarted(false);
  const wasInPlayback = !!playbackBlob;

    // If currently recording, stop gracefully before switching
    if (recordingPhase === "recording") {
      discardRecording();
    }
    setPlaybackBlob(null);
    setActiveMotionId(null);
    setActiveMotionName(undefined);
    pendingPlaybackRef.current = null;
    handlePhaseChange("idle");
    closeLibrary();
    setLibraryButtonActive(false);
    // Only reinitiate mediapipe when coming out of playback — if we were
    // already in live mode, there is no need to reset it
    if (wasInPlayback) {
      setMediapipeReady(false);
    }
  }, [recordingPhase, handlePhaseChange, playbackBlob, closeLibrary]);

  // ── When library opens, stop recording gracefully and re-check auth ──��──────
  const handleOpenLibrary = useCallback(() => {
    if (recordingPhase === "recording") {
      discardRecording();
      handlePhaseChange("idle");
    }
    // Re-check Drive access every time the panel opens so the logged-in state
    // is never stale (covers OAuth redirect and tab-focus edge cases)
    const currentlyHasDrive = hasDriveAccess();
    setHasDrive(currentlyHasDrive);

    // Guests see the auth popup instead of the library panel
    if (!currentlyHasDrive) {
      setShowLibraryAuthPopup(true);
      return;
    }

    setLibraryOpen(true);
    // Replace the motion library button with the live button
    setLibraryButtonActive(true);
  }, [recordingPhase, handlePhaseChange]);

  // ── Select motion from library ────────────────────────────────────────────
  const handleSelectMotion = useCallback((blob: Blob, file: DriveMotionFile) => {
    // Resolve the stored avatarUrl to a canonical current URL.
    //
    // Recordings may have been made with:
    //   (a) old local paths    – "/avatar/avatar3.glb"
    //   (b) Cloudinary URLs    – "https://res.cloudinary.com/da1zca4wj/.../avatar-braids.glb"
    //   (c) preview-domain URLs – "https://preview.vtuber.miniface.org/avatar/avatar3.glb"  (401s)
    //
    // Strategy: extract the filename from whatever was stored and look it up in
    // the current AVATAR_METADATA registry. If a match is found, use that
    // canonical URL (always up-to-date Cloudinary). If not found, fall back to
    // the stored value so unknown avatars still attempt to load.
    // resolveAvatarUrl always returns a real, loadable registry URL — it maps
    // legacy names (avatar1.glb…), Cloudinary/preview hosts, and dead local
    // paths onto the current registry, falling back to the default avatar for
    // anything unknown. This is what prevents a stale "/avatar/avatarN.glb"
    // reference from reaching GLTFLoader and crashing the app.
    const targetAvatarUrl = resolveAvatarUrl(file.avatarUrl);

    // If the motion was recorded on a different avatar (or we know its avatar
    // URL and it differs from current), swap the avatar first. The skeleton
    // loader will show while the new mesh loads; once avatarReady fires the
    // pendingPlaybackRef effect below will start playback automatically.
    if (targetAvatarUrl && targetAvatarUrl !== url) {
      pendingPlaybackRef.current = { blob, file };
      // Clear current playback so the canvas shows the loader cleanly
      setPlaybackBlob(null);
      // Pass keepPending=true so handleAvatarChange does NOT wipe the ref we just set
      handleAvatarChange(targetAvatarUrl, true);
      setActiveMotionId(file.driveFileId);
      setActiveMotionName(file.name.replace(/\.glb$/i, ""));
      return;
    }

    // Same avatar (or unknown avatar) — play immediately
    setPlaybackBlob(blob);
    setActiveMotionId(file.driveFileId);
    setActiveMotionName(file.name.replace(/\.glb$/i, ""));
    // Don't close the library on mobile — user might want to switch again
  }, [url, handleAvatarChange]);

  // ── When Drive first becomes available, upload any pending blob and refresh count ──
  // This covers two cases:
  //   1. User was already recording/reviewed before signing in (signs in during review).
  //   2. User signs in fresh and Drive tokens arrive via SIGNED_IN event.
  const prevHasDriveRef = useRef(false);
  useEffect(() => {
    if (hasDrive && !prevHasDriveRef.current) {
      prevHasDriveRef.current = true;

      const pending = latestPlaybackRef.current;
      if (pending) {
        // A recording was made before sign-in — upload it now.
        // subscribeMotionUploaded will handle status + optimistic insert.
        setDriveUploadStatus("uploading");
        uploadToDrive(pending.blob, pending.name, undefined, url ?? undefined)
          .then(() => {
            // subscribeMotionUploaded fires → sets "done" + pendingMotion + refreshKey
            setLibraryOpen(true);
          })
          .catch((err) => {
            console.warn("[app] Drive upload on sign-in failed:", err?.message);
            setDriveUploadStatus(err instanceof DriveQuotaError ? "quota" : "error");
          });
      } else {
        // No pending blob — just refresh the library count from Drive.
        listDriveMotions()
          .then((files) => setLibraryMotionCount(files.length))
          .catch(() => { });
      }
    }
    if (!hasDrive) {
      prevHasDriveRef.current = false;
      setDriveUploadStatus("idle");
    }
  }, [hasDrive]);

  const isInPlayback = playbackBlob !== null;
  const faceTrackingDisabled = isSwitcherDisabled || isInPlayback;

  const handleStopAnimation = useCallback(() => {
    setAnimationStarted(false);
    setMediapipeReady(false);
    setInitProgress(null);
    setInitError(null);
  }, []);

  return (
    <div className="App">
      <CameraPermissions
        onStreamReady={handleStreamReady}
        disabled={isSwitcherDisabled || isInPlayback}
        isFlipped={isFlipped}
        setIsFlipped={setIsFlipped}
        isAuthenticated={currentUser !== null}
  onLoginRequest={() => setShowAuthModal(true)}
  onStartAnimation={() => setAnimationStarted(true)}
  onStopAnimation={handleStopAnimation}
  animationStarted={animationStarted}
  isInPlayback={isInPlayback}
  />

      <TrackingLoader
        visible={currentUser !== null && animationStarted && avatarReady && videoStream != null && !mediapipeReady && !isInPlayback && !motionLoading}
        progress={initProgress}
        error={initError}
      />

      {currentUser !== null && animationStarted && videoStream && !isInPlayback && !motionLoading && (
        <FaceTracking
          videoStream={videoStream}
          onMediapipeReady={handleMediapipeReady}
          onInitProgress={setInitProgress}
          onInitError={setInitError}
          disabled={faceTrackingDisabled}
          isFlipped={isFlipped}
          onStopAnimation={handleStopAnimation}
        />
      )}

      {/* 3D Avatar Canvas */}
      <AvatarCanvas
        url={url}
        avatarKey={avatarKey}
        setAvatarReady={setAvatarReady}
        isFlipped={isFlipped}
        setIsFlipped={setIsFlipped}
        playbackBlob={playbackBlob}
        motionLoading={motionLoading}
      />

      {/* Top-right controls */}
      <div className="top-right-menu-bar-container bg-blur bg-soft-light br-100 pr-4 pl-4 pos-fixed top-0 right-0 z-9992 m-3 flex flex-row items-center gap-2">
        {libraryButtonActive || isInPlayback ? (
          <IconButton
            icon="live-icon"
            onClick={handleStartLive}
            title="Start live motion capture"
            className="icon-size-32"
            iconSize="icon-size-16"
            tooltip={true}
            tooltipPosition="pos-bottom"
            tooltipText="back to live"
          />
        ) : (
          <MotionLibraryButton
            onClick={handleOpenLibrary}
            motionCount={hasDrive ? libraryMotionCount : 0}
          />
        )}
        <AuthButton
          user={currentUser}
          onDriveConnected={() => setHasDrive(hasDriveAccess())}
          onLoginRequest={() => setShowAuthModal(true)}
        />
      </div>

      {/* Library auth popup — rendered at App root so it escapes all nested stacking contexts */}
      {showLibraryAuthPopup && !hasDrive && (
        <LibraryAuthPopup
          onClose={() => setShowLibraryAuthPopup(false)}
          onDriveConnected={() => {
            setShowLibraryAuthPopup(false);
            setHasDrive(hasDriveAccess());
          }}
          imgSrc={undefined}
        />
      )}

      <ColorSwitcher disabled={isSwitcherDisabled || isInPlayback} />
      <AvatarSwitcher activeUrl={url} onAvatarChange={handleAvatarChange} disabled={isSwitcherDisabled || isInPlayback || libraryOpen} />

      {/* Recording controls �� always rendered so the review overlay stays visible
          while playback is active. In idle phase, the "record" button is hidden
          when playback is already running (isInPlayback) so it doesn't overlap. */}
      <RecordingControls
        mediapipeReady={mediapipeReady}
        avatarReady={avatarReady}
        onPhaseChange={handlePhaseChange}
        onDoAnother={handleDoAnother}
        hideIdleWhenPlaying={isInPlayback}
      />

      {/* Playback scrubber bar — shown whenever playback blob is active */}
      {isInPlayback && (
        <PlaybackControls
          onTogglePlay={handleTogglePlay}
          onSeek={handleSeek}
          onDoAnother={handleDoAnother}
          onStartLive={handleStartLive}
          motionName={activeMotionName}
          onDownload={playbackBlob ? () => {
            const url = URL.createObjectURL(playbackBlob);
            const a = document.createElement("a");
            a.href = url;
            a.download = activeMotionName ? `${activeMotionName}.glb` : "motion.glb";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } : undefined}
        />
      )}

      {/* Motion Library panel — kept mounted during closing animation, then unmounted */}
      {(libraryOpen || libraryClosing) && (
        <MotionLibrary
          onClose={closeLibrary}
          isClosing={libraryClosing}
          activeMotionId={activeMotionId}
          onSelectMotion={handleSelectMotion}
          onStartLive={handleStartLive}
          bulkProgress={bulkProgress}
          refreshKey={libraryRefreshKey}
          pendingMotion={pendingMotion}
          quotaReached={driveUploadStatus === "quota"}
          isLoggedIn={hasDrive}
          onLoginRequest={() => setShowAuthModal(true)}
          onNoDriveAccessRetry={handleGoogleReAuth}
          onNoDriveAccess={setNoDriveAccessDetected}
          onDrivePermissionError={() => {
            // Stale token in sessionStorage caused a 403 — clear it so
            // hasDriveAccess() returns false, then surface the persistent popup.
            clearDriveTokens();
            setHasDrive(false);
            setNoDriveAccessDetected(true);
          }}
          isInPlayback={isInPlayback}
          playbackBlob={playbackBlob}
          isPendingUploading={driveUploadStatus === "uploading"}
          onMotionLoadingChange={setMotionLoading}
        />
      )}

      {/* No Drive access popup — shown persistently when signed in but Drive scope missing.
          Rendered at App root so it is always visible regardless of library open state. */}
      {!hasDrive && noDriveAccessDetected && (
        <PermissionPopup
          variant="prompt"
          aria-label="Google Drive access required"
          title="Google Drive permission is missing"
          className="no-drive-access-popup"
          backdrop={true}
          overlayClosesPopup={false}
        >
          <p className="subtitle prompt-subtitle" style={{ marginTop: "8px" }}>
            It looks like Drive access was not granted when you signed in. Sign in again and make sure to allow Drive — your motion will upload automatically once access is granted.
          </p>
          <button
            className="button primary w-full mt-8"
            onClick={handleGoogleReAuth}
            aria-label="Sign in again to grant Google Drive access"
          >
            <span className="has-icon icon-size-14 google-icon" aria-hidden="true" />
            continue with Google
          </button>
          <button
            className="button primary w-full mt-8"
            onClick={handleDriveDisconnect}
            disabled={driveDisconnecting}
            aria-label="Disconnect and sign out"
            style={{ background: "var(--bg-secondary)", color: "var(--text-primary)" }}
          >
            {driveDisconnecting ? "disconnecting..." : "disconnect"}
          </button>
        </PermissionPopup>
      )}

      {/* Post-record auth popup — shown to guests after recording stops */}
      {showPostRecordAuthPopup && !hasDrive && (
        <PostRecordAuthPopup
          onClose={() => {
            sessionStorage.setItem("postRecordAuthPopup_dismissed", "1");
            setShowPostRecordAuthPopup(false);
          }}
          onDriveConnected={() => {
            setShowPostRecordAuthPopup(false);
            setHasDrive(hasDriveAccess());
          }}
        />
      )}

      {/* Auth modal — triggered from library empty state or other call sites */}
      {showAuthModal && (
        <AuthModal
          initialUser={currentUser}
          onClose={() => setShowAuthModal(false)}
          onDriveConnected={() => {
            setShowAuthModal(false);
            setHasDrive(hasDriveAccess());
          }}
          hasPendingMotion={latestPlaybackRef.current !== null}
        />
      )}
    </div>
  );
}

export default App;
