<div align="left">
  
  ![gh face mocap demo](https://github.com/user-attachments/assets/741b1fdd-0dab-4e97-a24b-22a7d34b9a15)
  
  #  miniface - Facial and Finger Motion Capture
  
  **Real-time face tracking with 3D avatars in your browser** ✨
  Try it at : https://www.vtuber.miniface.org/
  MiniFace's facial and finger tracking motion capture uses the same technology and code as the miniFace.org ARKit blendshapes and real-time facial motion capture system.

  The core code is open source and available here. You can try it at https://www.vtuber.miniface.org/, where it has been tuned and designed specifically for streamers and VTubers.

  The professional version, which allows you to validate ARKit blendshapes and import your own character model into the motion capture system, is available at   https://miniface.org/faces/mocap.

  
 [![License: MIT-Attribution](https://img.shields.io/badge/License-MIT--Attribution-yellow.svg)](LICENSE.md)
 [![React](https://img.shields.io/badge/React-18.2.0-blue.svg)](https://reactjs.org/)
 [![Status](https://img.shields.io/badge/Status-Active-brightgreen.svg)]()
 [![Creator](https://img.shields.io/badge/Created%20by-Pooya%20Moradi%20M.-orange.svg)](https://github.com/pooyadeperson)
  [![Creator](https://img.shields.io/badge/Created%20by-Sercan%20Altundas-orange.svg)](https://github.com/srcnalt)

  
</div>

---

  ## 🎯 Roadmap
  [Roadmap](https://github.com/users/PooyaDeperson/projects/3/views/1?layout=board)

---

## 🚀 Quick Start

### Get Started
```bash
# Clone the project
git clone https://github.com/PooyaDeperson/miniface-facial-motion-capture.git
cd miniface-facial-motion-capture

# Install dependencies
npm install

# Start the service
npm run dev
```

Visit `http://localhost:3000` to see the face tracking in action!

### System Requirements
- Node.js 16+
- A modern browser with webcam access
- Webcam permissions (for face tracking)

---

## 💫 Project Vision

This project aims to provide a simple and effective way to perform real-time face tracking in the browser using Ready Player Me avatars.
It leverages the power of MediaPipe and Three.js to create an immersive experience where a 3D avatar mimics your facial movements.

---

## 🎯 Current Feature Status

### ✅ Implemented Features
- **🎤 Real-time Face Tracking**: Captures facial landmarks using MediaPipe in a dedicated worker thread.
- **🧵 Web Worker Architecture**: Face detection runs on a separate thread, keeping the main UI responsive.
- **🎬 3D Avatar Integration**: Renders Ready Player Me avatars with Three.js.
- **📹 Motion Capture Recording**: Record facial blendshapes and head/neck/spine bone movements in real-time.
- **💾 GLB Animation Export**: Save recorded animations as self-contained `.glb` files with full avatar geometry and animation data.
- **🎨 Avatar and Color Switcher**: Easily switch between different avatars and background colors.
- **🌪️ Secondary Motion System**: Spring-based physics for hair, clothing, and secondary body parts without a physics engine.
- **⚙️ Component-Based Architecture**: Built with React for a modular and maintainable codebase.
- **🌐 Web Application**: Runs entirely in the browser.

---

## 🏗️ Technical Architecture

### Core Design Principles
- **Performance**: Optimized for real-time performance in the browser.
- **Modularity**: Components are designed to be reusable and easy to understand.
- **Simplicity**: A straightforward setup and easy-to-follow codebase.

### Technology Stack
- **Frontend**: React, TypeScript, Three.js, react-three/fiber, react-three/drei
- **Face Tracking**: MediaPipe Tasks Vision (running in Web Worker)
- **Physics System**: Spring-based secondary motion (no external physics engine)
- **Build Tool**: Create React App
- **Export Format**: GLB (GLTF binary with embedded animations)

---

## 🛠️ Development Guide

### Environment Setup
1. Ensure you have Node.js installed (version 16 or higher).
2. Run `npm install` to install the necessary dependencies.
3. Run `npm start` to launch the development server.

### Contribution Guidelines
1. Fork the project repository.
2. Create a new branch for your feature (`git checkout -b feature/your-feature-name`).
3. Make your changes and commit them (`git commit -m 'Add some amazing feature'`).
4. Push your changes to the branch (`git push origin feature/your-feature-name`).
5. Open a Pull Request.

## ⚠️ ESLint / Build Warnings

Some ESLint warnings (missing `useEffect` dependencies, unused variables) were causing the build to fail. These issues did **not affect runtime**, which is why `master` deployed successfully.  

To deploy quickly, we temporarily set `CI=false` in Vercel (`vercel.json` or dashboard) so warnings are not treated as errors.  

> ⚠️ Future developers: These warnings should be properly fixed by wrapping functions in `useCallback` and including all dependencies in `useEffect`. Once fixed, `CI=false` can be removed to enforce lint rules in production.

---

## 📹 Motion Capture Recording

### Overview
Capture your facial expressions and head movements as animations on your selected avatar, then export them as `.glb` files for use in other 3D applications.

### How It Works
1. **Load an avatar** and enable MediaPipe face tracking
2. **Click "Record"** — The recording UI appears at the bottom of the screen
3. **Animate** with your face and head movements — A live timer shows recording duration
4. **Click "Stop"** to complete the recording
5. **Review** the captured animation with frame count and duration stats
6. **Save as GLB** — Exports a complete `.glb` file containing:
   - Full avatar mesh with all geometry
   - All skeletal bones (even if not animated)
   - All blendshapes (morphtargets) that were animated
   - Animation clip with keyframes for all animated properties
7. **Download** starts automatically with timestamped filename: `avatar-YYYY-MM-DD-HHmmss.glb`

### Recording UI States

#### Idle (Ready to Record)
- Shows a "Record" button in a pill-shaped container at the bottom
- Only visible when both avatar and MediaPipe are loaded
- Click to start recording

#### Recording (Live Capture)
- Red pulsing dot indicating active recording
- Live MM:SS timer showing elapsed time
- Frame counter showing number of frames captured
- "Stop" button to end recording
- UI stays visible even if MediaPipe momentarily loses the face

#### Review (Before Save)
- Displays final stats: frame count, total duration, frame rate
- "Save as GLB" button to export the animation
- "Discard" button to clear and start over
- Export error messages (if any) appear here
- Spinner shown during export

### Technical Details

**Captured Data per Frame:**
- All 52 facial blendshape scores (0-1 values)
- Head rotation (Euler angles: X, Y, Z)
- Timestamp for precise animation timing

**Export Format:**
- Binary GLB (gltf + embedded textures + animation)
- One `NumberKeyframeTrack` per animated morph target
- Three `QuaternionKeyframeTrack` entries for Head, Neck, and Spine2 bones
- AnimationClip automatically bound to the exported model

**File Size:**
- Typically 2–5 MB depending on animation length and complexity
- Optimized to skip static blendshapes (keeps file lean)

**Compatibility:**
- Opens in any GLB/glTF viewer (Babylon.js, Three.js, Blender, etc.)
- Animation included and ready to play
- Can be imported into game engines (Unity, Unreal) as FBX or GLB

### Edge Cases Handled
- Switching avatars automatically discards stale recordings
- Fewer than 2 captured frames rejected on export
- Missing bones safely handled (guard for non-RPM rigs)
- Export errors caught and displayed in UI
- Live timer stops recording if browser tab loses focus briefly

---

## 🌪️ Secondary Motion System

### Overview
A lightweight spring-based physics system for realistic secondary motion on hair, clothing, and other secondary body parts without requiring an external physics engine.

### How It Works
The system uses a Verlet integration approach with configurable per-chain physics:

1. **Spring chains**: Define chains of bones (e.g., ponytail, skirt) with a driver bone
2. **Driver-based inertia**: Chain follows driver movement with configurable lag
3. **Gravity simulation**: Gentle constant downward bias for natural droop
4. **Damping & stiffness**: Per-chain controls for feel and response
5. **Velocity smoothing**: Exponential smoothing for responsive yet stable motion

### Configuration
Each chain requires:
- `id`: Unique identifier
- `driver`: Bone whose movement drives the chain
- `chainStart` & `chainEnd`: Bone range in the spring chain
- `stiffness`: Spring strength (0–1, default 0.28)
- `damping`: Velocity damping (0–1, default 0.80)
- `gravity`: Downward sag bias (default 0.07)
- `inertiaScale`: Driver velocity lag multiplier (default 0.08)
- `smoothing`: Driver velocity smoothing (0–1, default 0.12)

### Technical Details
- **Per-frame algorithm**: Rest-pose computation → gravity sag → inertia offset → spring constraint → Verlet integration → bone rotation
- **Performance**: O(n) complexity where n = chain length; no broad-phase collision detection
- **Frame-rate agnostic**: All calculations are delta-time normalized for consistent feel across 20–60+ fps
- **Integration points**: Bones always spring back to rest pose; no permanent drift

---

```
miniface-facial-motion-capture/
├── 📄 .gitignore              # Specifies intentionally untracked files to ignore
├── 📄 LICENSE.md              # MIT license with attribution requirement
├── 📄 package.json            # Project dependencies and npm scripts
├── 📄 package-lock.json       # Exact dependency versions
├── 📄 README.md               # Project overview and setup instructions
├── 📄 PROJECT_OVERVIEW.md     # Detailed technical documentation
├── 📄 tsconfig.json           # TypeScript compiler configuration
├── 📄 vercel.json             # Vercel deployment configuration
├── 📁 public/                 # Static assets served by the application
│   ├── 📁 animation/          # Idle animation GLB files
│   ├── 📁 images/
│   │   ├── 📁 app/
│   │   │   ├── 📁 avatar/     # Avatar preview images
│   │   │   ├── 📁 explainers/ # Camera and feature explainers
│   │   │   └── 📁 icons/      # UI and cursor icons
│   │   └── 📁 seo/            # SEO and social preview images
│   ├── 📁 models/             # MediaPipe model files
│   │   ├── 📄 face_landmarker.task
│   │   ├── 📄 hand_landmarker.task
│   │   └── 📄 pose_landmarker_lite.task
│   ├── 📁 wasm/               # MediaPipe WebAssembly runtime files
│   ├── 📄 index.html          # Application entry HTML
│   ├── 📄 manifest.json       # PWA manifest
│   ├── 📄 robots.txt          # Crawler configuration
│   └── 📄 sitemap.xml         # Sitemap for search engines
└── 📁 src/                    # React and TypeScript source code
    ├── 📁 components/         # Reusable UI components and styles
    ├── 📁 pages/              # Marketing and legal pages
    ├── 📄 App.tsx             # Root application component
    ├── 📄 Avatar.tsx          # 3D avatar rendering and animation
    ├── 📄 AvatarCanvas.tsx    # Three.js scene and canvas
    ├── 📄 AvatarLoader.tsx    # Avatar loading state UI
    ├── 📄 AvatarOrbitControls.tsx # Avatar camera controls
    ├── 📄 FaceTracking.tsx    # Face tracking host and worker bridge
    ├── 📄 faceWorker.js       # MediaPipe face tracking Web Worker
    ├── 📄 SecondaryMotionSystem.ts # Spring-based secondary motion
    ├── 📄 smoothing.ts        # Real-time motion smoothing utilities
    ├── 📄 useAnimationPlayer.ts # Idle animation playback hook
    ├── 📄 useDriveSync.ts     # Drive synchronization hook
    ├── 📄 useMotionRecorder.ts # Recording and GLB export hook
    ├── 📄 usePlaybackAnimation.ts # Recorded animation playback hook
    ├── 📄 useSecondaryMotion.ts # Secondary motion integration hook
    ├── 📄 avatarMetadata.ts   # Avatar metadata and configuration
    ├── 📄 authRedirect.ts     # Authentication redirect handling
    ├── 📄 camera-permission.tsx # Camera permission and device selection
    ├── 📄 color.css           # Color theme definitions
    ├── 📄 components.css      # Shared component styles
    ├── 📄 index.css           # Global styles
    ├── 📄 index.tsx           # React application entry point
    ├── 📄 supabaseClient.ts   # Supabase client configuration
    └── 📄 react-app-env.d.ts  # React environment type declarations
```
