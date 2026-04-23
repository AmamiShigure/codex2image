import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0b0d12',
        panel: '#141820',
        panel2: '#1b2029',
        border: '#262c36',
        accent: '#6ea8ff',
        text: '#e6e9ef',
        mute: '#8a93a6',
      },
    },
  },
  plugins: [],
}
export default config
