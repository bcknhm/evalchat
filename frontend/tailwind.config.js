/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          navy:    '#0c446c',
          blue:    '#135a8a',
          mid:     '#1e7ab0',
          light:   '#5eb3df',
          pale:    '#eaf5fb',
          pale2:   '#f4f9fd',
          border:  '#c8dfe9',
          border2: '#ddeef5',
        },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
}
