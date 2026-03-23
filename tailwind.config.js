/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'industrial': {
          'black': '#0B0F14',
          'graphite': '#11161D',
          'slate': '#161C24',
          'border': '#232A33',
          'text': '#E6EDF3',
          'muted': '#9BA7B4',
          'accent': '#3A8DFF',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      fontSize: {
        'h1': ['48px', { lineHeight: '1.2', letterSpacing: '-0.01em', fontWeight: '600' }],
        'h2': ['28px', { lineHeight: '1.3', fontWeight: '600' }],
        'h3': ['20px', { lineHeight: '1.4', fontWeight: '600' }],
        'body': ['16px', { lineHeight: '1.5', fontWeight: '400' }],
        'caption': ['13px', { lineHeight: '1.4', fontWeight: '400' }],
        'chat': ['15px', { lineHeight: '1.6', fontWeight: '400' }],
        'button': ['14px', { lineHeight: '1', fontWeight: '500' }],
      },
      spacing: {
        '8': '8px',
        '12': '12px',
        '16': '16px',
        '24': '24px',
        '32': '32px',
        '48': '48px',
        '64': '64px',
      },
      borderRadius: {
        'panel': '12px',
        'button': '10px',
        'input': '8px',
      },
      boxShadow: {
        'premium': '0px 2px 8px rgba(0,0,0,0.35)',
      },
    },
  },
  plugins: [],
};
