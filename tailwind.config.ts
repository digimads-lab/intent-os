import type { Config } from 'tailwindcss'

export default {
  content: ['./src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff6ff',
          500: '#3b82f6',
          600: '#2563eb',
          900: '#1e3a8a',
        }
      }
    }
  },
  plugins: [],
} satisfies Config
