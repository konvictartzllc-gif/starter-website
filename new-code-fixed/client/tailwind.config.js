/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#6d28d9", light: "#8b5cf6", dark: "#4c1d95" },
      },
    },
  },
  plugins: [],
};
