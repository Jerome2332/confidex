import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#000000",
        surface: {
          5: "rgba(255,255,255,0.05)",
          10: "rgba(255,255,255,0.10)",
          20: "rgba(255,255,255,0.20)",
        },
        border: {
          subtle: "rgba(255,255,255,0.10)",
          emphasis: "rgba(255,255,255,0.20)",
        },
        buy: {
          bg: "rgba(16,185,129,0.20)",
          text: "rgba(52,211,153,0.80)",
          border: "rgba(16,185,129,0.30)",
        },
        sell: {
          bg: "rgba(244,63,94,0.20)",
          text: "rgba(251,113,133,0.80)",
          border: "rgba(244,63,94,0.30)",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
