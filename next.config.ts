import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
let supabasePattern: { protocol?: "http" | "https"; hostname: string; port?: string; pathname?: string } | null = null;

if (supabaseUrl) {
  try {
    const parsed = new URL(supabaseUrl);
    supabasePattern = {
      protocol: parsed.protocol === "http:" ? "http" : "https",
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      pathname: "/**",
    };
  } catch {
    // Ignore invalid or empty URL at build time
  }
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns: supabasePattern ? [supabasePattern] : [],
  },
};

export default nextConfig;
