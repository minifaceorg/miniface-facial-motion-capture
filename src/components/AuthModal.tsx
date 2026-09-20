/*
 * Copyright (c) 2025 Pooya Moradi M. poamrd@gmail.com https://github.com/PooyaDeperson
 * Licensed under the MIT License with Attribution.
 */

import { useState, useEffect, useRef } from "react";
import { supabase, isSupabaseAvailable } from "../supabaseClient";
import { hasDriveAccess, DRIVE_SCOPE } from "../useDriveSync";
import type { User } from "@supabase/supabase-js";
import PermissionPopup from "./PermissionPopup";
import { getAuthRedirectUrl, rememberAuthReturnUrl } from "../authRedirect";

interface AuthModalProps {
  onClose: () => void;
  /** Called after Drive scope is successfully obtained */
  onDriveConnected?: () => void;
  /**
   * When true the modal shows a stronger "you have an unsaved recording"
   * message to encourage the user to grant Drive access.
   */
  hasPendingMotion?: boolean;
  /**
   * The already-resolved user from the parent. Passing this avoids the
   * async-flash where the modal briefly shows the signed-out view while
   * waiting for getSession() to resolve.
   */
  initialUser?: User | null;
}

export default function AuthModal({ onClose, onDriveConnected, hasPendingMotion = false, initialUser = null }: AuthModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [driveConnected, setDriveConnected] = useState(() => hasDriveAccess());
  // Tracks that sign-out was explicitly requested so the auth state listener
  // does not flip the modal back to the signed-out view before reload fires.
  const signingOutRef = useRef(false);

  // Use the prop directly — no local user state at all. This prevents the
  // classic useState(prop) trap where the state is seeded once at mount and
  // ignores later prop updates.
  const user = initialUser;

  useEffect(() => {
    if (!supabase) return;

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (signingOutRef.current) return;

      // Only react to a real new sign-in, not the INITIAL_SESSION replay that
      // Supabase fires immediately when the listener is registered. Treating
      // INITIAL_SESSION as a sign-in was the cause of the modal auto-closing:
      // it would detect Drive access and call onDriveConnected(), dismissing
      // the popup before the user even saw it.
      if (event !== "SIGNED_IN") return;

      // Small delay to allow supabaseClient.ts to store tokens first
      setTimeout(() => {
        const connected = hasDriveAccess();
        setDriveConnected(connected);
        if (session?.user && connected) onDriveConnected?.();
      }, 100);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, [onDriveConnected]);

  /** Sign in with Google + Drive appdata scope */
  const handleGoogleLoginWithDrive = async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    rememberAuthReturnUrl();
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: getAuthRedirectUrl(),
        skipBrowserRedirect: false,
        scopes: DRIVE_SCOPE,
          queryParams: {
            access_type: "offline",
            prompt: "consent",
            // Keep the Drive grant when Google re-authenticates the user.
            include_granted_scopes: "true",
          },
      },
    });
    if (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    // Mark sign-out in progress so the onAuthStateChange listener does not
    // flip the modal to the signed-out view before the page reloads.
    signingOutRef.current = true;
    setLoading(true);
    // Close the modal immediately so the user never sees the sign-in popup
    // flash up while Supabase processes the sign-out in the background.
    onClose();
    await supabase.auth.signOut();
    window.location.reload();
  };

  if (user) {
    /* ── Signed-in state ── */
    return (
      <PermissionPopup
        variant="prompt"
        centered
        backdrop
        onBackdropClick={onClose}
        aria-label="Account"
        avatar={{
          src: user.user_metadata?.avatar_url,
          alt: user.user_metadata?.full_name ?? "avatar",
          fallback: user.user_metadata?.full_name ?? user.email ?? "?",
        }}
        title={`hey, ${user.user_metadata?.full_name ?? "welcome back"}`}
        className="auth-popup"
      >
        <p className="subtitle prompt-subtitle">
          you are connected as,<br />
          {user.email}
        </p>

        {/* Drive connection status */}
        {driveConnected ? (
          <p className="subtitle prompt-subtitle mt-8" style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
            Google Drive is connected. Your motions are syncing to the cloud.
          </p>
        ) : (
          <>
            {/* ── Drive scope missing ── */}
            <div
              className="ml-no-drive-banner"
              role="alert"
              style={{
                marginTop: "12px",
                padding: "12px 14px",
                borderRadius: "10px",
                background: "var(--bg-secondary, rgba(255,255,255,0.06))",
                border: "1px solid var(--border-color, rgba(255,255,255,0.12))",
              }}
            >
              <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color: "var(--text-primary)" }}>
                <strong>Google Drive access was not granted.</strong>
              </p>
              <p style={{ margin: "6px 0 0", fontSize: "13px", lineHeight: 1.5, color: "var(--text-secondary)" }}>
                {hasPendingMotion
                  ? "Your recorded motion is still here and will be saved automatically once you grant access. Click below and make sure to check the Google Drive checkbox when Google asks."
                  : "To save and sync your motions, you need to allow access to Google Drive. Click below and make sure to check the Google Drive checkbox when Google asks."}
              </p>
            </div>
            <button
              className="button primary w-full mt-8"
              onClick={handleGoogleLoginWithDrive}
              disabled={loading || !isSupabaseAvailable()}
            >
              {loading ? (
                <>
                  <span className="spinner spinner-sm" />
                  connecting&hellip;
                </>
              ) : (
                <>
                  <span className="has-icon icon-size-16 google-icon" />
                  grant Google Drive access
                </>
              )}
            </button>
          </>
        )}

        {error && (
          <p className="subtitle denied-subtitle error-banner mt-8" role="alert">
            {error}
          </p>
        )}

        <button
          className="button primary w-full mt-8"
          onClick={handleSignOut}
          disabled={loading}
          style={{ background: "var(--bg-secondary)", color: "var(--text-primary)" }}
        >
          {loading ? "disconnecting..." : "disconnect"}
        </button>
      </PermissionPopup>
    );
  }

  /* ── Signed-out state ── */
  return (
    <PermissionPopup
      variant="prompt"
      centered
      backdrop
      onBackdropClick={onClose}
      aria-label="Sign in"
      title="connect to animate and save your motions"
      className="auth-popup"
    >
      <p className="subtitle prompt-subtitle mt-4">
        verify that you are human using your Google email...{" "}
        By continuing you agree to{" "}
        <a href="/terms" target="_blank" rel="noreferrer">Terms</a> and{" "}
        <a href="/privacy" target="_blank" rel="noreferrer">Privacy</a>.
      </p>

      {/* Supabase not configured */}
      {!isSupabaseAvailable() && (
        <p className="subtitle denied-subtitle error-banner mt-4" role="status">
          auth not configured — set Supabase env vars to enable sign in
        </p>
      )}

      {/* Error banner */}
      {error && (
        <p className="subtitle denied-subtitle error-banner" role="alert">
          {error}
        </p>
      )}

      {/* Google sign-in button (always requests Drive scope) */}
      <button
        className="button primary prompt-button flex flex-row justify-center items-center gap-1 w-full mt-8"
        onClick={handleGoogleLoginWithDrive}
        disabled={loading || !isSupabaseAvailable()}
      >
        {loading ? (
          <>
            <span className="spinner spinner-sm" />
            connecting&hellip;
          </>
        ) : (
          <>
            <span className="has-icon icon-size-16 google-icon" />
            continue with google
          </>
        )}
      </button>
    </PermissionPopup>
  );
}
