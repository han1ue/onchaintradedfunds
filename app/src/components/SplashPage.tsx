import { ArrowRight } from "lucide-react";
import type { CSSProperties } from "react";
import { APP_ORIGIN } from "@/lib/app-host-routing";

const FLOW_LINES = Array.from({ length: 24 }, (_, index) => {
  const startY = 86 + index * 31;
  const pinchY = 420 + (index - 11.5) * 5.5;
  const endY = 118 + ((index * 47) % 670);

  return {
    d: `M 80 ${startY} C 300 ${startY - 42} 420 ${pinchY - 96} 568 ${pinchY} C 720 ${pinchY + 110} 852 ${endY - 58} 1120 ${endY}`,
    opacity: 0.12 + (index % 6) * 0.055,
  };
});

const ORBIT_LINES = Array.from({ length: 14 }, (_, index) => ({
  rx: 118 + index * 18,
  ry: 36 + index * 9,
  opacity: 0.1 + index * 0.022,
  rotation: -24 + index * 2.2,
}));

export function SplashPage() {
  return (
    <main className="splashPage">
      <div className="splashEffect" aria-hidden="true">
        <svg viewBox="0 0 1200 900" preserveAspectRatio="xMidYMid slice">
          <defs>
            <linearGradient id="splash-flow" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#526600" stopOpacity="0" />
              <stop offset="0.44" stopColor="#ccff00" />
              <stop offset="0.68" stopColor="#efffb0" />
              <stop offset="1" stopColor="#ccff00" stopOpacity="0" />
            </linearGradient>
            <radialGradient id="splash-core" cx="50%" cy="50%" r="50%">
              <stop offset="0" stopColor="#f7ffd8" stopOpacity="0.92" />
              <stop offset="0.16" stopColor="#d8ff3d" stopOpacity="0.64" />
              <stop offset="0.5" stopColor="#718c00" stopOpacity="0.2" />
              <stop offset="1" stopColor="#050505" stopOpacity="0" />
            </radialGradient>
            <filter id="splash-soft-glow" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="34" />
            </filter>
            <filter id="splash-line-glow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="2.6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <circle className="splashCoreGlow" cx="590" cy="440" r="230" fill="url(#splash-core)" filter="url(#splash-soft-glow)" />

          <g className="splashFlowLines" fill="none" stroke="url(#splash-flow)" strokeWidth="1.15" filter="url(#splash-line-glow)">
            {FLOW_LINES.map((line, index) => (
              <path
                key={line.d}
                d={line.d}
                opacity={line.opacity}
                pathLength="1"
                style={{
                  animationDelay: `${index * -0.21}s`,
                  animationDuration: `${8 + index * 0.18}s`,
                } as CSSProperties}
              />
            ))}
          </g>

          <g className="splashOrbitLines" fill="none" stroke="url(#splash-flow)" strokeWidth="1">
            {ORBIT_LINES.map((orbit) => (
              <ellipse
                key={orbit.rx}
                cx="590"
                cy="440"
                rx={orbit.rx}
                ry={orbit.ry}
                opacity={orbit.opacity}
                transform={`rotate(${orbit.rotation} 590 440)`}
              />
            ))}
          </g>

          <circle className="splashCoreRing" cx="590" cy="440" r="72" fill="none" stroke="#efffb0" strokeOpacity="0.72" strokeWidth="1.2" />
          <circle cx="590" cy="440" r="5" fill="#f7ffd8" />
        </svg>
      </div>

      <section className="splashCopy" aria-labelledby="splash-title">
        <h1 id="splash-title">
          <span>onchain</span>
          <span>traded</span>
          <span>funds</span>
        </h1>
        <p>the standard for the new era</p>
      </section>

      <a className="splashEnter" href={APP_ORIGIN}>
        <span>Go to app</span>
        <ArrowRight aria-hidden="true" size={18} strokeWidth={1.8} />
      </a>
    </main>
  );
}
