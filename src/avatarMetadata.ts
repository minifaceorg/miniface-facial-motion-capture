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
 * avatarMetadata.ts
 *
 * Central registry for per-avatar secondary motion configuration.
 *
 * SecondaryChainConfig (from SecondaryMotionSystem)
 * ─────────────────────────────────────────────────
 *   id               – unique identifier for this chain
 *   driver           – bone whose world movement drives the simulation
 *   chainStart       – first bone in the spring chain (inclusive)
 *   chainEnd         – last bone in the spring chain (inclusive)
 *   stiffness        – how strongly each bone springs back toward rest     (0–1, default 0.3)
 *   damping          – velocity damping each frame; higher = less wobble   (0–1, default 0.85)
 *   gravity          – constant downward sag on the rest target            (default 0.08)
 *   inertiaScale     – how much driver velocity lags the chain             (default 0.08)
 *   collisionMeshes     – (prototype) mesh name(s) for bounding-box collision — O(vertex count)/frame
 *                         single string OR array, matched by scene node name
 *   collisionSpheresDef – (production) explicit sphere list — O(1)/frame, exact radius
 *                         each entry: { node: "sceneName", radius: 0.12 }
 *                         sculpt sphere meshes in Blender, parent each to ONE bone,
 *                         list them here with the measured radius
 *   collisionMargin     – extra stand-off in metres on top of the collision radius
 *                         default 0.02 (2 cm); set to 0 for flush contact
 *
 * AvatarMetadata
 * ───────────────
 *   avatarPath       – URL key used to look up metadata
 *   secondaryMotion  – array of chain configs; empty = no secondary motion
 */

import type { SecondaryChainConfig } from "./SecondaryMotionSystem";

export type { SecondaryChainConfig };

export interface AvatarMetadata {
  /** The avatar's public URL path, used as the lookup key. */
  avatarPath: string;
  /** Avatar display name for UI and cache keys */
  displayName: string;
  /** Secondary motion chains to simulate. Empty array = no simulation. */
  secondaryMotion: SecondaryChainConfig[];
}

// ─── Avatar URLs ──────────────────────────────────────────────────────────────
// To bust the browser cache for a specific avatar, bump its Cloudinary version
// number (e.g. v1782023142 → v1782023143) or append a query param (?v=2).

const AVATAR_URLS = {
  ponytail:
    "https://pooyadeperson.github.io/miniface-dns/assets/vtuber/avatar-ponytail.glb",

  short:
    "https://pooyadeperson.github.io/miniface-dns/assets/vtuber/avatar-short.glb",

  curly:
    "https://pooyadeperson.github.io/miniface-dns/assets/vtuber/avatar-curly.glb",

  wavy:
    "https://pooyadeperson.github.io/miniface-dns/assets/vtuber/avatar-wavy.glb",

  braids:
    "https://pooyadeperson.github.io/miniface-dns/assets/vtuber/avatar-braids.glb",
};

// ─── Registry ────────────────────────────────────────────────────────────────

const AVATAR_METADATA: AvatarMetadata[] = [
  // ── Avatar 1 (Ponytail) ───────────────────────────────────────────────────
  // Driver: hair_head (the parent bone driven by head movement)
  // Chain:  hair_1 … hair_7 (individual strands branching from hair_head)
  {
    avatarPath: AVATAR_URLS.ponytail,
    displayName: "ponytail",
    // Ponytail: hair_head is the driver; chain runs hair_1 → hair_7.
    secondaryMotion: [
      {
        id: "ponytail",
        driver: "hair_head",
        chainStart: "hair_1",
        chainEnd: "hair_7",
        stiffness: 0.05,    // Spring strength: lower = softer return (0.02-0.05 for smooth decay, 0.2+ for snappy)
        damping: 0.15,      // safe ranges : damping: 0.70 – 0.90 damping too low = unstable energy loss Velocity retention: lower = less jitter (0.2 good for jitter-free, 0.7+ for bouncy)
        gravity: 0.08,      // Natural droop amount: increase for more sag (0.05-0.15 typical)
        inertiaScale: 0.5, // Lag intensity: how much tail lags behind driver (0.3-0.5 for natural feel)
        smoothing: 0.99,    // Velocity filter: higher = smoother movement, less micro-jitter (0.1-0.2 responsive, 0.8+ smooth)
        // COLLISION — using Strategy A (O(1)/frame, exact geometry radius):
        // col_neck and col_head are UV-sphere SkinnedMeshes parented to their
        // respective bones. Radius is auto-read from geometry × world scale
        // at init — no manual measurement needed. Enable DEBUG_COLLISION_SPHERES
        // in Avatar.tsx to verify the sphere sizes visually.
        // Radii are diameter / 2 from Blender's object Dimensions field (metres).
        // Blender shows the full diameter in Dimensions, not the radius —
        // so 0.255931 m diameter → 0.127966 m radius, etc.
        collisionSpheresDef: [
          { node: "col_neck", radius: 0.255931 / 2 },
          { node: "col_head", radius: 0.293352 / 2 },
        ],
        collisionMargin: 0.00,
      },
      {
        id: "bang",
        driver: "hairstrands1_1",
        chainStart: "hairstrands1_2",
        chainEnd: "hairstrands1_3",
        stiffness: 0.01,    // Spring strength: lower = softer return (0.02-0.05 for smooth decay, 0.2+ for snappy)
        damping: 0.01,      // safe ranges : damping: 0.70 – 0.90 damping too low = unstable energy loss Velocity retention: lower = less jitter (0.2 good for jitter-free, 0.7+ for bouncy)
        gravity: 0.01,      // Natural droop amount: increase for more sag (0.05-0.15 typical)
        inertiaScale: 0.5, // Lag intensity: how much tail lags behind driver (0.3-0.5 for natural feel)
        smoothing: 0.0,    // Velocity filter: higher = smoother movement, less micro-jitter (0.1-0.2 responsive, 0.8+ smooth)
        // COLLISION — using Strategy A (O(1)/frame, exact geometry radius):
        // col_neck and col_head are UV-sphere SkinnedMeshes parented to their
        // respective bones. Radius is auto-read from geometry × world scale
        // at init — no manual measurement needed. Enable DEBUG_COLLISION_SPHERES
        // in Avatar.tsx to verify the sphere sizes visually.
        // Radii are diameter / 2 from Blender's object Dimensions field (metres).
        // Blender shows the full diameter in Dimensions, not the radius —
        // so 0.255931 m diameter → 0.127966 m radius, etc.
        collisionSpheresDef: [

          { node: "col_head", radius: 0.25 / 2 },
        ],
        collisionMargin: 0.00,
      },
    ],
  },

  // ── Avatar 2 (Short) ─────────────────────────────────────────────────────
  {
    avatarPath: AVATAR_URLS.short,
    displayName: "short",
    secondaryMotion: [
      {
        id: "hairstrands_left",
        driver: "LeftHair_head",
        chainStart: "LeftHair_1",
        chainEnd: "LeftHair_6",
        stiffness: 0.05,    // Spring strength: lower = softer return (0.02-0.05 for smooth decay, 0.2+ for snappy)
        damping: 0.15,      // safe ranges : damping: 0.70 – 0.90 damping too low = unstable energy loss Velocity retention: lower = less jitter (0.2 good for jitter-free, 0.7+ for bouncy)
        gravity: 0.08,      // Natural droop amount: increase for more sag (0.05-0.15 typical)
        inertiaScale: 0.5, // Lag intensity: how much tail lags behind driver (0.3-0.5 for natural feel)
        smoothing: 0.99,    // Velocity filter: higher = smoother movement, less micro-jitter (0.1-0.2 responsive, 0.8+ smooth)
        // COLLISION — using Strategy A (O(1)/frame, exact geometry radius):
        // col_neck and col_head are UV-sphere SkinnedMeshes parented to their
        // respective bones. Radius is auto-read from geometry × world scale
        // at init — no manual measurement needed. Enable DEBUG_COLLISION_SPHERES
        // in Avatar.tsx to verify the sphere sizes visually.
        // Radii are diameter / 2 from Blender's object Dimensions field (metres).
        // Blender shows the full diameter in Dimensions, not the radius —
        // so 0.255931 m diameter → 0.127966 m radius, etc.
        // collisionSpheresDef: [
        //   { node: "col_neck", radius: 0.268359 / 2 },
        // ],
        // collisionMargin: 0.00,
      },
      {
        id: "hairstrand1_1",
        driver: "hairstrand1_1",
        chainStart: "hairstrand1_1",
        chainEnd: "hairstrand1_3",
        stiffness: 0.15,    // Spring strength: lower = softer return (0.02-0.05 for smooth decay, 0.2+ for snappy)
        damping: 0.15,      // safe ranges : damping: 0.70 – 0.90 damping too low = unstable energy loss Velocity retention: lower = less jitter (0.2 good for jitter-free, 0.7+ for bouncy)
        gravity: 0.08,      // Natural droop amount: increase for more sag (0.05-0.15 typical)
        inertiaScale: 0.5,  // Lag intensity: how much tail lags behind driver (0.3-0.5 for natural feel)
        smoothing: 0.99,    // Velocity filter: higher = smoother movement, less micro-jitter (0.1-0.2 responsive, 0.8+ smooth)

      },
      {
        id: "hairstrand2_1",
        driver: "hairstrand2_1",
        chainStart: "hairstrand2_1",
        chainEnd: "hairstrand2_3",
        stiffness: 0.15,    // Spring strength: lower = softer return (0.02-0.05 for smooth decay, 0.2+ for snappy)
        damping: 0.15,      // safe ranges : damping: 0.70 – 0.90 damping too low = unstable energy loss Velocity retention: lower = less jitter (0.2 good for jitter-free, 0.7+ for bouncy)
        gravity: 0.08,      // Natural droop amount: increase for more sag (0.05-0.15 typical)
        inertiaScale: 0.5,  // Lag intensity: how much tail lags behind driver (0.3-0.5 for natural feel)
        smoothing: 0.99,    // Velocity filter: higher = smoother movement, less micro-jitter (0.1-0.2 responsive, 0.8+ smooth)

      },
      {
        id: "hairstrand3_1",
        driver: "hairstrand3_1",
        chainStart: "hairstrand3_2",
        chainEnd: "hairstrand3_3",
        stiffness: 0.25,    // Spring strength: lower = softer return (0.02-0.05 for smooth decay, 0.2+ for snappy)
        damping: 0.15,      // safe ranges : damping: 0.70 – 0.90 damping too low = unstable energy loss Velocity retention: lower = less jitter (0.2 good for jitter-free, 0.7+ for bouncy)
        gravity: 0.08,      // Natural droop amount: increase for more sag (0.05-0.15 typical)
        inertiaScale: 0.5,  // Lag intensity: how much tail lags behind driver (0.3-0.5 for natural feel)
        smoothing: 0.99,    // Velocity filter: higher = smoother movement, less micro-jitter (0.1-0.2 responsive, 0.8+ smooth)

      },
      {
        id: "hairstrand4_1",
        driver: "hairstrand4_1",
        chainStart: "hairstrand4_2",
        chainEnd: "hairstrand4_3",
        stiffness: 0.05,    // Spring strength: lower = softer return (0.02-0.05 for smooth decay, 0.2+ for snappy)
        damping: 0.15,      // safe ranges : damping: 0.70 – 0.90 damping too low = unstable energy loss Velocity retention: lower = less jitter (0.2 good for jitter-free, 0.7+ for bouncy)
        gravity: 0.08,      // Natural droop amount: increase for more sag (0.05-0.15 typical)
        inertiaScale: 0.5,  // Lag intensity: how much tail lags behind driver (0.3-0.5 for natural feel)
        smoothing: 0.99,    // Velocity filter: higher = smoother movement, less micro-jitter (0.1-0.2 responsive, 0.8+ smooth)

      },
    ],
  },

  // ── Avatar 3 (Curly) ─────────────────────────────────────────────────────
  {
    avatarPath: AVATAR_URLS.curly,
    displayName: "curly",
    secondaryMotion: [],
  },

  // ── Avatar 4 (Wavy) ──────────────────────────────────────────────────────
  {
    avatarPath: AVATAR_URLS.wavy,
    displayName: "wavy",
    // Ponytail: hair_head is the driver; chain runs hair_1 → hair_7.
    secondaryMotion: [
      {
        id: "hairstrands_left",
        driver: "LeftHair_head",
        chainStart: "LeftHair_1",
        chainEnd: "LeftHair_6",
        stiffness: 0.05,    // Spring strength: lower = softer return (0.02-0.05 for smooth decay, 0.2+ for snappy)
        damping: 0.15,      // safe ranges : damping: 0.70 – 0.90 damping too low = unstable energy loss Velocity retention: lower = less jitter (0.2 good for jitter-free, 0.7+ for bouncy)
        gravity: 0.08,      // Natural droop amount: increase for more sag (0.05-0.15 typical)
        inertiaScale: 0.5, // Lag intensity: how much tail lags behind driver (0.3-0.5 for natural feel)
        smoothing: 0.99,    // Velocity filter: higher = smoother movement, less micro-jitter (0.1-0.2 responsive, 0.8+ smooth)
        // COLLISION — using Strategy A (O(1)/frame, exact geometry radius):
        // col_neck and col_head are UV-sphere SkinnedMeshes parented to their
        // respective bones. Radius is auto-read from geometry × world scale
        // at init — no manual measurement needed. Enable DEBUG_COLLISION_SPHERES
        // in Avatar.tsx to verify the sphere sizes visually.
        // Radii are diameter / 2 from Blender's object Dimensions field (metres).
        // Blender shows the full diameter in Dimensions, not the radius —
        // so 0.255931 m diameter → 0.127966 m radius, etc.
        collisionSpheresDef: [
          { node: "col_neck", radius: 0.268359 / 2 },
        ],
        collisionMargin: 0.00,
      },
      {
        id: "hairstrands_right",
        driver: "RightHair_head",
        chainStart: "RightHair_1",
        chainEnd: "RightHair_6",
        stiffness: 0.05,    // Spring strength: lower = softer return (0.02-0.05 for smooth decay, 0.2+ for snappy)
        damping: 0.15,      // safe ranges : damping: 0.70 – 0.90 damping too low = unstable energy loss Velocity retention: lower = less jitter (0.2 good for jitter-free, 0.7+ for bouncy)
        gravity: 0.08,      // Natural droop amount: increase for more sag (0.05-0.15 typical)
        inertiaScale: 0.5,  // Lag intensity: how much tail lags behind driver (0.3-0.5 for natural feel)
        smoothing: 0.99,    // Velocity filter: higher = smoother movement, less micro-jitter (0.1-0.2 responsive, 0.8+ smooth)
        // COLLISION — using Strategy A (O(1)/frame, exact geometry radius):
        // col_neck and col_head are UV-sphere SkinnedMeshes parented to their
        // respective bones. Radius is auto-read from geometry × world scale
        // at init — no manual measurement needed. Enable DEBUG_COLLISION_SPHERES
        // in Avatar.tsx to verify the sphere sizes visually.
        // Radii are diameter / 2 from Blender's object Dimensions field (metres).
        // Blender shows the full diameter in Dimensions, not the radius —
        // so 0.255931 m diameter → 0.127966 m radius, etc.
        collisionSpheresDef: [
          { node: "col_neck", radius: 0.268359 / 2 },
        ],
        collisionMargin: 0.00,
      },
    ],
  },

  // ── Avatar 5 (Braids) ────────────────────────────────────────────────────
  {
    avatarPath: AVATAR_URLS.braids,
    displayName: "braids",
    secondaryMotion: [],
  },
];

// ─── Lookup helpers ──────────────────────────────────────────────────────────

/**
 * Returns the metadata for the given avatar URL, or a safe default
 * (no secondary motion) if the avatar is not registered.
 */
export function getAvatarMetadata(avatarPath: string): AvatarMetadata {
  const found = AVATAR_METADATA.find((m) => m.avatarPath === avatarPath);
  if (!found) {
    return { avatarPath, displayName: "unknown", secondaryMotion: [] };
  }
  return found;
}

/**
 * Get all available avatars as an array
 */
export function getAllAvatars(): AvatarMetadata[] {
  return AVATAR_METADATA.filter((m) => m.avatarPath); // Only return avatars with valid URLs
}

/**
 * Resolve ANY stored avatar reference to a canonical, currently-loadable URL.
 *
 * Motion files (and localStorage) may hold avatar URLs saved across several
 * naming/hosting schemes over the app's life:
 *   • current registry URLs   – "https://.../avatar-ponytail.glb"
 *   • Cloudinary / preview URLs that still use the new avatar-<style>.glb names
 *   • legacy local paths       – "/avatar/avatar1.glb" … "/avatar/avatar5.glb"
 *   • dead local paths          – any other "/avatar/*.glb" that no longer exists
 *
 * A dead local path is the crash trigger: the SPA server answers the 404 with
 * index.html, GLTFLoader receives "<!doctype html>" and throws while parsing,
 * taking down the whole render tree. This resolver guarantees the returned URL
 * is always a real registry entry, so a bad/stale reference can never reach the
 * loader. It is deliberately universal — old and new motion data both funnel
 * through the same lookup.
 */
export function resolveAvatarUrl(stored: string | null | undefined): string {
  const avatars = getAllAvatars();
  const fallback = avatars[0]?.avatarPath ?? "";
  if (!stored) return fallback;

  // Already a canonical registry URL — use as-is.
  if (avatars.some((a) => a.avatarPath === stored)) return stored;

  const fileOf = (u: string) =>
    (u.split("/").pop()?.split("?")[0] ?? "").toLowerCase();
  const storedFilename = fileOf(stored);

  // Match by current filename (covers Cloudinary/preview variants that kept the
  // new avatar-<style>.glb naming but a different host).
  const byFilename = avatars.find((a) => fileOf(a.avatarPath) === storedFilename);
  if (byFilename) return byFilename.avatarPath;

  // Legacy naming: avatar1.glb … avatarN.glb mapped to registry order.
  const legacy = storedFilename.match(/^avatar(\d+)\.glb$/);
  if (legacy) {
    const idx = parseInt(legacy[1], 10) - 1;
    if (idx >= 0 && idx < avatars.length) return avatars[idx].avatarPath;
  }

  // Unknown or dead path — never hand it to the loader. Use the default avatar.
  return fallback;
}
