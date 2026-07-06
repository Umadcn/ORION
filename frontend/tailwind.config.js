/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Mission-control dark palette.
        space: {
          950: '#05070f',
          900: '#0a0e1a',
          850: '#0d1220',
          800: '#111827',
          700: '#1b2436',
          600: '#273349',
          500: '#3a4a66',
        },
        accent: {
          blue: '#3b82f6',
          cyan: '#22d3ee',
          green: '#22c55e',
          orange: '#f59e0b',
          red: '#ef4444',
          purple: '#a855f7',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
      boxShadow: {
        panel: '0 1px 3px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3)',
        glow: '0 0 0 1px rgba(59,130,246,0.25)',
      },
    },
  },
  plugins: [],
};
