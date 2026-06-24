export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        vscode: {
          bg: '#0a0a0a',
          card: '#111111',
          panel: '#111111',
          border: '#222222',
          blue: '#3b82f6',
        },
        surface: {
          base: '#0a0a0a',
          sidebar: '#0f0f0f',
          card: '#111111',
          subtle: '#151515',
          raised: '#1a1a1a',
          hover: '#2a2a2a',
          border: '#222222',
          input: '#333333',
        },
        text: {
          primary: '#f5f5f5',
          muted: '#888888',
          faint: '#666666',
        },
        brand: {
          primary: '#3b82f6',
          hover: '#2563eb',
          border: '#1d4ed8',
          soft: '#93c5fd',
        },
        status: {
          danger: '#ef4444',
          dangerSoft: '#fca5a5',
          good: '#22c55e',
          warning: '#f59e0b',
        },
      },
    },
  },
  plugins: [],
};
