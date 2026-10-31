import React from "react";
import Link from "next/link";
import { BRAND_NAME, BRAND_NAME_DEVANAGARI, BRAND_TAGLINE } from "@/lib/brand";

interface NagrikLogoProps {
  showTagline?: boolean;
  size?: "sm" | "md" | "lg";
  href?: string | null;
  className?: string;
}

export function TricolourMapPin({ size = 36 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
      aria-hidden="true"
    >
      {/* Modern Pin Drop Shadow */}
      <ellipse cx="18" cy="32.5" rx="7.5" ry="2" fill="#3B1A6E" fillOpacity="0.12" />

      {/* Outer Pin Body */}
      <path
        d="M18 3C11.3726 3 6 8.37258 6 15C6 22.875 16.2 31.05 17.25 31.875C17.7 32.25 18.3 32.25 18.75 31.875C19.8 31.05 30 22.875 30 15C30 8.37258 24.6274 3 18 3Z"
        fill="#3B1A6E"
      />

      {/* Inner Circular Well */}
      <circle cx="18" cy="14" r="7.5" fill="#FFFFFF" />

      {/* Tricolour Concentric Indicator (Saffron, White, Green) */}
      <g clipPath="url(#tricolour-clip)">
        <rect x="11" y="7" width="14" height="4.66" fill="#FF9933" />
        <rect x="11" y="11.66" width="14" height="4.66" fill="#FFFFFF" />
        <rect x="11" y="16.32" width="14" height="4.66" fill="#138808" />
      </g>

      {/* Inner Pin Point Center */}
      <circle cx="18" cy="14" r="2.5" fill="#3B1A6E" />

      <defs>
        <clipPath id="tricolour-clip">
          <circle cx="18" cy="14" r="6" />
        </clipPath>
      </defs>
    </svg>
  );
}

export default function NagrikLogo({
  showTagline = false,
  size = "md",
  href = "/",
  className = "",
}: NagrikLogoProps) {
  const pinSize = size === "sm" ? 30 : size === "lg" ? 44 : 36;
  const brandSize =
    size === "sm"
      ? "text-lg"
      : size === "lg"
      ? "text-2xl"
      : "text-xl";
  const devanagariSize =
    size === "sm"
      ? "text-xs"
      : size === "lg"
      ? "text-sm"
      : "text-xs";

  const content = (
    <div className={`flex flex-col ${className}`}>
      <div className="flex items-center gap-3">
        <TricolourMapPin size={pinSize} />
        <div className="flex items-baseline gap-2">
          <span className={`font-bold tracking-tight text-slate-900 ${brandSize}`}>
            {BRAND_NAME}
          </span>
          <span
            className={`font-semibold text-slate-500 font-[family-name:var(--font-noto-devanagari)] ${devanagariSize}`}
            lang="hi"
          >
            {BRAND_NAME_DEVANAGARI}
          </span>
        </div>
      </div>
      {showTagline && (
        <p className="mt-1 text-xs sm:text-sm text-slate-500 font-normal">
          {BRAND_TAGLINE}
        </p>
      )}
    </div>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="inline-flex focus:outline-none focus:ring-2 focus:ring-[#3B1A6E]/30 rounded-lg"
        aria-label={`${BRAND_NAME} - ${BRAND_TAGLINE}`}
      >
        {content}
      </Link>
    );
  }

  return content;
}
