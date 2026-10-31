import React from "react";

/**
 * Minimalist geometric graphic of community collaboration.
 * Features a connected network of circles and hexagons in soft white,
 * saffron (#FF9933), and green (#138808) at low opacity.
 * Pure vector inline SVG - no photos, no external images, no national emblems.
 */
export default function CommunityNetworkGraphic({ className = "" }: { className?: string }) {
  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      <svg
        viewBox="0 0 520 460"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full max-w-[460px] h-auto drop-shadow-sm"
        aria-hidden="true"
      >
        <defs>
          {/* Subtle glow filter */}
          <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>

          {/* Saffron linear gradient for link lines */}
          <linearGradient id="linkSaffron" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#FF9933" stopOpacity="0.4" />
          </linearGradient>

          {/* Green linear gradient for link lines */}
          <linearGradient id="linkGreen" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#138808" stopOpacity="0.4" />
          </linearGradient>

          {/* Radial ambient background highlight */}
          <radialGradient id="centralAura" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.08" />
            <stop offset="60%" stopColor="#FFFFFF" stopOpacity="0.02" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Ambient background soft glow */}
        <circle cx="260" cy="230" r="180" fill="url(#centralAura)" />

        {/* Background Network Grid Lines (Interconnecting community collaboration links) */}
        <g stroke="white" strokeOpacity="0.14" strokeWidth="1.2">
          {/* Outer constellation lines */}
          <line x1="140" y1="120" x2="260" y2="90" />
          <line x1="260" y1="90" x2="380" y2="130" />
          <line x1="380" y1="130" x2="420" y2="240" />
          <line x1="420" y1="240" x2="360" y2="340" />
          <line x1="360" y1="340" x2="260" y2="370" />
          <line x1="260" y1="370" x2="150" y2="330" />
          <line x1="150" y1="330" x2="100" y2="220" />
          <line x1="100" y1="220" x2="140" y2="120" />

          {/* Inner radial hub connection lines */}
          <line x1="140" y1="120" x2="260" y2="230" stroke="url(#linkSaffron)" strokeWidth="1.6" />
          <line x1="260" y1="90" x2="260" y2="230" stroke="white" strokeOpacity="0.25" />
          <line x1="380" y1="130" x2="260" y2="230" stroke="url(#linkSaffron)" strokeWidth="1.6" />
          <line x1="420" y1="240" x2="260" y2="230" stroke="white" strokeOpacity="0.25" />
          <line x1="360" y1="340" x2="260" y2="230" stroke="url(#linkGreen)" strokeWidth="1.6" />
          <line x1="260" y1="370" x2="260" y2="230" stroke="white" strokeOpacity="0.25" />
          <line x1="150" y1="330" x2="260" y2="230" stroke="url(#linkGreen)" strokeWidth="1.6" />
          <line x1="100" y1="220" x2="260" y2="230" stroke="white" strokeOpacity="0.25" />

          {/* Cross chords */}
          <line x1="140" y1="120" x2="360" y2="340" strokeOpacity="0.08" strokeDasharray="4 4" />
          <line x1="380" y1="130" x2="150" y2="330" strokeOpacity="0.08" strokeDasharray="4 4" />
          <line x1="100" y1="220" x2="420" y2="240" strokeOpacity="0.08" strokeDasharray="4 4" />
        </g>

        {/* Concentric Guide Rings */}
        <circle
          cx="260"
          cy="230"
          r="130"
          stroke="white"
          strokeOpacity="0.1"
          strokeWidth="1"
          strokeDasharray="3 6"
        />
        <circle
          cx="260"
          cy="230"
          r="70"
          stroke="white"
          strokeOpacity="0.16"
          strokeWidth="1"
        />

        {/* Hexagons: Representing structured municipal & community units */}
        {/* Top-Right Saffron Hexagon */}
        <polygon
          points="380,110 397,120 397,140 380,150 363,140 363,120"
          fill="#FF9933"
          fillOpacity="0.22"
          stroke="#FF9933"
          strokeOpacity="0.5"
          strokeWidth="1.5"
        />
        <circle cx="380" cy="130" r="3" fill="#FF9933" fillOpacity="0.9" />

        {/* Top-Left Saffron Hexagon */}
        <polygon
          points="140,102 156,111 156,129 140,138 124,129 124,111"
          fill="#FF9933"
          fillOpacity="0.18"
          stroke="#FF9933"
          strokeOpacity="0.45"
          strokeWidth="1.2"
        />
        <circle cx="140" cy="120" r="2.5" fill="#FF9933" fillOpacity="0.85" />

        {/* Bottom-Right Green Hexagon */}
        <polygon
          points="360,320 377,330 377,350 360,360 343,350 343,330"
          fill="#138808"
          fillOpacity="0.22"
          stroke="#138808"
          strokeOpacity="0.5"
          strokeWidth="1.5"
        />
        <circle cx="360" cy="340" r="3" fill="#138808" fillOpacity="0.9" />

        {/* Bottom-Left Green Hexagon */}
        <polygon
          points="150,312 166,321 166,339 150,348 134,339 134,321"
          fill="#138808"
          fillOpacity="0.18"
          stroke="#138808"
          strokeOpacity="0.45"
          strokeWidth="1.2"
        />
        <circle cx="150" cy="330" r="2.5" fill="#138808" fillOpacity="0.85" />

        {/* Side Soft White Hexagons */}
        <polygon
          points="100,205 113,212 113,228 100,235 87,228 87,212"
          fill="white"
          fillOpacity="0.12"
          stroke="white"
          strokeOpacity="0.3"
          strokeWidth="1.2"
        />
        <polygon
          points="420,225 433,232 433,248 420,255 407,248 407,232"
          fill="white"
          fillOpacity="0.12"
          stroke="white"
          strokeOpacity="0.3"
          strokeWidth="1.2"
        />

        {/* Peripheral Node Circles (Citizen reports & active verification nodes) */}
        <circle cx="260" cy="90" r="6" fill="white" fillOpacity="0.25" stroke="white" strokeOpacity="0.5" strokeWidth="1.5" />
        <circle cx="260" cy="90" r="2" fill="white" />

        <circle cx="260" cy="370" r="6" fill="white" fillOpacity="0.25" stroke="white" strokeOpacity="0.5" strokeWidth="1.5" />
        <circle cx="260" cy="370" r="2" fill="white" />

        <circle cx="195" cy="170" r="4.5" fill="#FF9933" fillOpacity="0.3" stroke="#FF9933" strokeOpacity="0.6" strokeWidth="1" />
        <circle cx="325" cy="175" r="4.5" fill="#FF9933" fillOpacity="0.3" stroke="#FF9933" strokeOpacity="0.6" strokeWidth="1" />

        <circle cx="205" cy="285" r="4.5" fill="#138808" fillOpacity="0.3" stroke="#138808" strokeOpacity="0.6" strokeWidth="1" />
        <circle cx="315" cy="290" r="4.5" fill="#138808" fillOpacity="0.3" stroke="#138808" strokeOpacity="0.6" strokeWidth="1" />

        {/* Auxiliary mini telemetry nodes */}
        <circle cx="70" cy="170" r="2.5" fill="white" fillOpacity="0.3" />
        <circle cx="450" cy="170" r="2.5" fill="white" fillOpacity="0.3" />
        <circle cx="80" cy="290" r="2.5" fill="white" fillOpacity="0.3" />
        <circle cx="440" cy="300" r="2.5" fill="white" fillOpacity="0.3" />

        {/* Central Core Collaboration Nexus (A nested geometric circle & hex node) */}
        <circle
          cx="260"
          cy="230"
          r="34"
          fill="white"
          fillOpacity="0.08"
          stroke="white"
          strokeOpacity="0.25"
          strokeWidth="1.5"
        />
        {/* Core Hexagon */}
        <polygon
          points="260,208 279,219 279,241 260,252 241,241 241,219"
          fill="#3B1A6E"
          stroke="white"
          strokeOpacity="0.45"
          strokeWidth="1.5"
        />
        {/* Inner Hub Point */}
        <circle cx="260" cy="230" r="5" fill="white" fillOpacity="0.95" />
      </svg>
    </div>
  );
}
