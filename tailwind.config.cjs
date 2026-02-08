module.exports = {
  content: ["./src/renderer/**/*.{ts,tsx,html}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["'Space Grotesk'", "sans-serif"],
        body: ["'Spline Sans'", "sans-serif"]
      },
      boxShadow: {
        soft: "0 20px 60px rgba(15, 23, 42, 0.16)",
        glow: "0 0 0 1px rgba(99, 102, 241, 0.08), 0 14px 30px rgba(15, 23, 42, 0.18)"
      },
      colors: {
        ink: {
          900: "#0f172a",
          800: "#1e293b",
          700: "#334155",
          600: "#475569"
        },
        slatewash: "#f8fafc",
        mist: "#e2e8f0",
        spotlight: "#93c5fd",
        ocean: "#0ea5e9",
        coral: "#fb7185"
      }
    }
  },
  darkMode: "class",
  plugins: []
};
