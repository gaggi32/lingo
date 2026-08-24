/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "media",
  content: ["./index.html", "./pop.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Lingo's accent: an indigo that leans violet. Used for the mark, the
        // active nav item, focus rings and the translate button.
        iris: {
          50: "#f3f1ff",
          100: "#e9e5ff",
          200: "#d6ceff",
          300: "#b9aaff",
          400: "#977bff",
          500: "#7a50f7",
          600: "#6832e8",
          700: "#5a24cc",
          800: "#4b20a6",
          900: "#3f1f85",
          950: "#26124f",
        },
      },
      fontFamily: {
        // Translated text gets a slightly warmer, more readable stack than the
        // UI chrome so the two never blur together.
        reading: [
          "ui-serif",
          "Georgia",
          "Cambria",
          "Times New Roman",
          "serif",
        ],
      },
    },
  },
  plugins: [],
};
