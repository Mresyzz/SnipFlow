/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        dark: {
          950: "#0b0c10",
          900: "#12151e",
          850: "#171b26",
          800: "#1f2433",
          700: "#2d3449",
        },
        cyan: {
          400: "#00f2fe",
          500: "#00d5df",
        },
        danger: {
          500: "#ff0844",
        },
      },
    },
  },
  plugins: [],
};
