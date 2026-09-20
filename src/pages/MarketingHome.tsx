import { useEffect, useState, type CSSProperties } from "react";
import "./marketing.css";

const VIDEO_SRC =
  "https://res.cloudinary.com/da1zca4wj/video/upload/v1789469805/vtuber.miniface.demo_nbfiwm.mp4";
const VIDEO_POSTER =
  "/images/seo/vtuber.miniface.demo.poster.webp";

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

const AUDIENCE_WORDS = [
  { label: "streamers", color: "#b694ff" },
  { label: "vtubers", color: "#d09aff" },
  { label: "animators", color: "#9b83ff" },
];

function RotatingAudienceWord() {
  const [wordIndex, setWordIndex] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setWordIndex((currentIndex) => (currentIndex + 1) % AUDIENCE_WORDS.length);
    }, 2800);

    return () => window.clearInterval(interval);
  }, []);

  const word = AUDIENCE_WORDS[wordIndex];

  return (
    <span
      className="hero-audience-word"
      style={{ "--audience-color": word.color } as CSSProperties}
      aria-live="polite"
    >
      <span className="hero-audience-word__label" key={word.label}>
        {word.label}
      </span>
    </span>
  );
}

function ProductVideo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`marketing-video br-20 ${compact ? "marketing-video--compact" : ""}`}>
      <video
        autoPlay
        muted
        loop
        playsInline
        poster={VIDEO_POSTER}
        src={VIDEO_SRC}
        aria-label="Miniface motion capture product demonstration"
        className="br-20"
      />
      {/* <div className="video-caption"><span className="status-dot" />Live capture / Miniface</div> */}
    </div>
  );
}

export default function MarketingHome() {
  const currentYear = new Date().getFullYear();

  return (
    <main className="marketing-page">
      <nav className="marketing-nav" aria-label="Main navigation">
        <a className="brand-mark" href="/" aria-label="Miniface home">
          <img className="brand-logo" src="/images/seo/favicon180.jpg" alt="" />
          <span>miniface for vtubers</span>
        </a>
        {/* <div className="nav-links">
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
        </div>
        <a className="button" href="/animate">Start creating</a> */}
      </nav>

      <section className="marketing-hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          {/* <p className="eyebrow"><span className="eyebrow-line" />Browser-based motion capture</p> */}
          <h1 id="hero-title">
            realtime facial and finger motion capture <em>for <RotatingAudienceWord />.</em>
          </h1>
          <p className="hero-description">bring your digital character to life from the camera you already have. Capture facial expressions, finger gestures, and live reactions in real time for streams, videos, and virtual performances.</p>
          <a className="button primary regular" href="/animate">start animating</a>
        </div>
        {/* <div className="hero-meta" aria-label="Product highlights">
          <span>01 / 05</span><span>Face + hands + character</span>
        </div> */}
      </section>

      <section className="showcase" aria-label="Product demonstration" id="how-it-works">
        <ProductVideo />
        {/* <div className="showcase-note"><span>Motion, without the hardware.</span><span>Scroll to explore ↓</span></div> */}
      </section>

      <section className="feature-intro feature-intro--compact" id="features" aria-labelledby="features-title">
        {/* <p className="eyebrow"><span className="eyebrow-line" />Everything you need to perform</p> */}
        <h2 id="features-title">more ways.<span> to perform.</span></h2>
        <p className="feature-summary">miniface for vtubers gives streamers and streamer VTubers browser-based face tracking, finger motion capture, and expressive avatar animation. Choose your character, record performances for the motion library, and create from the camera you already have, even on mobile.</p>
        <a className="button primary regular" href="/animate">animate now</a>
      </section>

      <footer className="marketing-footer">
        <a className="brand-mark" href="/" aria-label="Miniface for vtubers home"><img className="brand-logo" src="/images/seo/favicon180.jpg" alt="" /><span>miniface for vtubers</span></a>
        <span>realtime open source and free facial motion capture</span>
        <div><a href="/privacy">Privacy</a><a href="/terms">Terms</a><span>© 2024 - {currentYear} miniface</span></div>
      </footer>
    </main>
  );
}
