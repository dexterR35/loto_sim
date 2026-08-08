/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif']
      },
      colors: {
        ink: '#222222',
        field: '#f7f7f7',
        line: '#ebebeb',
        primary: {
          DEFAULT: 'rgb(var(--color-primary) / <alpha-value>)',
          dark: 'rgb(var(--color-primary-dark) / <alpha-value>)',
          light: 'rgb(var(--color-primary-light) / <alpha-value>)',
          soft: 'rgb(var(--color-primary-soft) / <alpha-value>)'
        },
        secondary: {
          DEFAULT: '#008489',
          dark: '#006c70',
          soft: '#e8f6f6'
        },
        teal: '#008489',
        coral: '#ff385c',
        gold: '#ffb400',
        grape: '#484848',
        muted: '#717171'
      },
      boxShadow: {
        panel: '0 6px 16px rgba(0, 0, 0, 0.12)',
        card: '0 2px 8px rgba(0, 0, 0, 0.08)'
      }
    }
  },
  plugins: []
};
