/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: '#0b0e14',
        panel: '#161b22',
        border: '#30363d',
        text: '#c9d1d9',
        muted: '#8b949e',
        accent: '#58a6ff',
        success: '#3fb950',
        warning: '#d29922',
        danger: '#f85149',
      },
    },
  },
  plugins: [],
};
