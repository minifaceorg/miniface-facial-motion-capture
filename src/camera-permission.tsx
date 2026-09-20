
/*
 * Copyright (c) 2025 Pooya Moradi M. poamrd@gmail.com https://github.com/PooyaDeperson
 * Licensed under the MIT License with Attribution.
 * 
 * Permission is hereby granted, free of charge, to use, copy, modify, merge,
 * publish, and distribute this software, provided that the following credit
 * is included in any derivative or distributed version:
 * "Created by Pooya Moradi M. poamrd@gmail.com https://github.com/PooyaDeperson"
 */


import { useCallback, useEffect, useRef, useState } from "react";
import CustomDropdown, { Option } from "./components/CustomDropdown";
import IconButton from "./components/IconButton";
import PermissionPopup from "./components/PermissionPopup";

const CameraIcon = (
  <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h2l2-3h10l2 3h2v13H3V7z" />
    <circle cx="12" cy="13" r="3" stroke="currentColor" strokeWidth="2" />
  </svg>
);

const VideoIcon = (
  <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276a1 1 0 011.447.894v8.764a1 1 0 01-1.447.894L15 14M4 6h11a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z" />
  </svg>
);

interface CameraPermissionsProps {
  onStreamReady: (stream: MediaStream) => void;
  disabled?: boolean;
  isFlipped?: boolean;
  setIsFlipped?: (v: boolean) => void;
  isAuthenticated: boolean;
  onLoginRequest: () => void;
  onStartAnimation: () => void;
  onStopAnimation: () => void;
  animationStarted: boolean;
  isInPlayback?: boolean;
}

export default function CameraPermissions({
  onStreamReady,
  disabled,
  isFlipped,
  setIsFlipped,
  isAuthenticated,
  onLoginRequest,
  onStartAnimation,
  onStopAnimation,
  animationStarted,
  isInPlayback = false,
}: CameraPermissionsProps) {
  const [permissionState, setPermissionState] = useState<"prompt" | "denied" | "granted" | "inuse">("prompt");
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null);
  const [cameraPromptAcknowledged, setCameraPromptAcknowledged] = useState(false);
  const [startAnimationPending, setStartAnimationPending] = useState(false);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const cameraRequestIdRef = useRef(0);

  const requestCamera = async (deviceId?: string) => {
    const requestId = ++cameraRequestIdRef.current;

    try {
      // Acquire the replacement before stopping the current stream. This keeps
      // the preview alive while switching and avoids a black frame when a
      // device takes a moment to release its video track.

      // On mobile, strict resolution constraints (e.g. 1280x720) cause
      // getUserMedia to fail or return a degraded stream on many Samsung/Xiaomi
      // front cameras. Use ideal (not exact) constraints so the browser can
      // negotiate the best available resolution.
      const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
      const videoConstraints: MediaTrackConstraints = deviceId
        ? { deviceId: { exact: deviceId } }
        : isMobile
          ? { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 } };

      const constraints: MediaStreamConstraints = {
        video: videoConstraints,
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      // A newer selection may have completed while this request was pending.
      // Discard the stale stream instead of letting it replace the current feed.
      if (requestId !== cameraRequestIdRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const previousStream = activeStreamRef.current;
      activeStreamRef.current = stream;
      setPreviewStream(stream);
      setPermissionState("granted");
      setCameraPromptAcknowledged(true);

      previousStream?.getTracks().forEach((track) => track.stop());
      onStreamReady(stream);
    } catch (err: any) {
      // Ignore failures from an outdated selection; a newer request owns the UI.
      if (requestId !== cameraRequestIdRef.current) return;

      // NotReadableError / AbortError → hardware is locked by another app or tab
      // NotAllowedError / PermissionDeniedError → user blocked access in the browser
      const name: string = err?.name ?? "";
      if (name === "NotReadableError" || name === "AbortError") {
        setPermissionState("inuse");
      } else {
        setPermissionState("denied");
      }
    }
  };

  const loadCameras = useCallback(async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = devices.filter((d) => d.kind === "videoinput");
    setCameras(videoInputs);

    const savedCamera = localStorage.getItem("selectedCamera");
    const preferredCamera = savedCamera && videoInputs.find((d) => d.deviceId === savedCamera)
      ? savedCamera
      : videoInputs[0]?.deviceId ?? null;

    setSelectedCamera(preferredCamera);
    return { devices: videoInputs, preferredCamera };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const handleCameraAccessLost = useCallback(() => {
    cameraRequestIdRef.current += 1;
    activeStreamRef.current?.getTracks().forEach((track) => track.stop());
    activeStreamRef.current = null;
    setPreviewStream(null);
    setCameraPromptAcknowledged(false);
    setPermissionState("denied");
    setCameras([]);
    if (animationStarted) onStopAnimation();
  }, [animationStarted, onStopAnimation]);

  const handleCameraChange = (deviceId: string) => {
    if (animationStarted) return;
    setSelectedCamera(deviceId);
    localStorage.setItem("selectedCamera", deviceId);
    void requestCamera(deviceId);
  };

  const handleStartAnimation = () => {
    if (!isAuthenticated) {
      setStartAnimationPending(true);
      onLoginRequest();
      return;
    }

    setStartAnimationPending(false);
    onStartAnimation();
  };

  useEffect(() => {
    if (isAuthenticated && startAnimationPending) {
      setStartAnimationPending(false);
      onStartAnimation();
    }
  }, [isAuthenticated, onStartAnimation, startAnimationPending]);

  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video || !previewStream) return;

    video.srcObject = previewStream;
    const playPreview = () => {
      void video.play().catch(() => undefined);
    };
    video.addEventListener("loadedmetadata", playPreview);
    playPreview();

    return () => {
      video.removeEventListener("loadedmetadata", playPreview);
      if (video.srcObject === previewStream) video.srcObject = null;
    };
  }, [previewStream, cameraPromptAcknowledged, animationStarted, isInPlayback]);

  useEffect(() => {
    if (!navigator.permissions) return;

    let permissionStatus: PermissionStatus | null = null;
    let cancelled = false;

    const applyPermissionState = async (state: PermissionState) => {
      if (cancelled) return;

      if (state === "granted") {
        setPermissionState("granted");
        setCameraPromptAcknowledged(true);
        const { preferredCamera } = await loadCameras();
        if (!cancelled && !activeStreamRef.current && preferredCamera) {
          void requestCamera(preferredCamera);
        }
        return;
      }

      if (state === "denied") {
        handleCameraAccessLost();
      } else {
        setPermissionState("prompt");
      }
    };

    navigator.permissions.query({ name: "camera" as PermissionName }).then((result) => {
      if (cancelled) return;
      permissionStatus = result;
      void applyPermissionState(result.state);
      result.onchange = () => void applyPermissionState(result.state);
    });

    return () => {
      cancelled = true;
      if (permissionStatus) permissionStatus.onchange = null;
    };
  }, [handleCameraAccessLost, loadCameras]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const stream = activeStreamRef.current;
    if (!stream) return;

    const handleTrackEnded = () => {
      if (stream === activeStreamRef.current && stream.getVideoTracks().every((track) => track.readyState === "ended")) {
        handleCameraAccessLost();
      }
    };

    stream.getVideoTracks().forEach((track) => track.addEventListener("ended", handleTrackEnded));
    return () => stream.getVideoTracks().forEach((track) => track.removeEventListener("ended", handleTrackEnded));
  }, [previewStream, handleCameraAccessLost]);

  const dropdownOptions: Option[] = cameras.map((cam, idx) => {
    const icon = idx % 2 === 0 ? CameraIcon : VideoIcon;
    return {
      label: cam.label || `Camera ${idx + 1}`,
      value: cam.deviceId,
      icon,
    };
  });

  return (
    <>
      {permissionState === "prompt" && !cameraPromptAcknowledged && (
        <PermissionPopup
          variant="prompt"
          title="pssst… give camera access to animate!"
          subtitle="use your camera for fun face animation! by tapping 'allow camera access' you agree to camera and cookie use."
          buttonText="allow camera access"
          onClick={() => requestCamera(selectedCamera || undefined)}
          showButton
        />
      )}

      {permissionState === "denied" && (() => {
        const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
        return (
          <PermissionPopup
            variant="denied"
            title="oh... you haven't given camera access yet."
            image={isMobile
              ? "/images/app/explainers/campermission-denied-mobile.webp"
              : "/images/app/explainers/campermission-denied-pc.webp"
            }
            imagAlt={isMobile
              ? "How to enable camera permission on mobile"
              : "How to enable camera permission on desktop"
            }
            subtitle="at the top, tap the Site Info icon and enable the camera toggle in the settings."
            showButton={false}
          />
        );
      })()}

      {permissionState === "inuse" && (
        <PermissionPopup
          variant="denied"
          title="your camera is being used by another app."
          subtitle="looks like Zoom, Teams, or another tab has your camera open. close it, then come back here and we'll get you set up!"
          buttonText="try again"
          onClick={() => requestCamera(selectedCamera || undefined)}
          showButton
        />
      )}

      {cameraPromptAcknowledged && activeStreamRef.current && !animationStarted && !isInPlayback && (
        <div className="camera-preview-start flex pos-fixed flex-col camera-feed w-135 overflow-hidden tb:w-400 br-12 tb:br-24 m-2 p-2 bg-blur z-999">
          <video
            ref={previewVideoRef}
            autoPlay
            playsInline
            muted
            aria-label="Camera preview"
            className={`camera-preview br-12 ${isFlipped ? "flipped-x" : ""}`}
          />
          <button
            type="button"
            className="button primary prompt-button"
            onClick={handleStartAnimation}
          >
            animate
          </button>
        </div>
      )}

      {/* Main control div */}
      <div className={`flex flex-row flex-start gap-1 pos-abs reveal fade scaleIn top-0 left-0 z-9991 m-1 tb:m-6`}>
        {permissionState === "granted" && cameras.length > 1 && (
          <div className={`flex camera-selection cp-dropdown ${disabled || animationStarted ? " switcher-disabled" : ""}`}>

            <CustomDropdown
              options={dropdownOptions}
              value={selectedCamera}
              onChange={handleCameraChange}
              placeholder="Select camera"
            />
          </div>
        )}
        <IconButton
          icon="flip-icon"
          iconSize="icon-size-18"
          className={`flex video-flip-switcher icon-holder br-12 tab-button size-30  ${isFlipped ? "flipped" : ""}`}
          onClick={() => setIsFlipped && setIsFlipped(!isFlipped)}
          title="Flip camera"
          ariaPressed={isFlipped}
        />
      </div>
    </>
  );
}
