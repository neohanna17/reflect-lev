/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#6d5efc',
          600: '#5a4cf0',
          700: '#4a3dd6',
        },
        ink: {
          900: '#0c0d12',
          800: '#13141b',
          700: '#1b1d27',
          600: '#262936',
          500: '#373b4d',
        },
      },
    },
  },
  plugins: [],
};
