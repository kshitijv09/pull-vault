import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      colors: {
        surface: {
          DEFAULT: "#050a10",
          raised: "#0b1220",
          sidebar: "#070d14"
        },
        accent: {
          DEFAULT: "#38bdf8",
          deep: "#0ea5e9"
        }
      },
      boxShadow: {
        "accent-glow": "0 0 40px -10px rgba(56, 189, 248, 0.55)",
        "accent-ring": "0 0 0 1px rgba(56, 189, 248, 0.35), 0 0 60px -12px rgba(56, 189, 248, 0.65)"
      },
      backgroundImage: {
        "hero-radial":
          "radial-gradient(ellipse 80% 60% at 50% 40%, rgba(15, 23, 42, 0.85) 0%, rgba(2, 6, 23, 0.2) 55%, rgba(2, 6, 23, 0) 100%)"
      }
    }
  },
  plugins: []
};

export default config;
