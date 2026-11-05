import type { Config } from 'tailwindcss';

// Palette: "Spring Plaza" — fresh fern greens, cherry-blossom pink, cool petal whites.
// Every colour is an RGB-channel CSS variable (see globals.css) so the same class works in light AND night mode,
// and Tailwind opacity modifiers (bg-surface/80, bg-fern/10 …) keep working.
const c = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: c('surface'),
        petal: { DEFAULT: c('petal'), 100: c('petal-100'), 200: c('petal-200') },
        bark: { DEFAULT: c('bark'), 500: c('bark-500'), 400: c('bark-400') },
        fern: { DEFAULT: c('fern'), dark: c('fern-dark'), hover: c('fern-hover'), ink: c('fern-ink'), light: c('fern-light') },
        blossom: { DEFAULT: c('blossom'), dark: c('blossom-dark'), ink: c('blossom-ink'), light: c('blossom-light') },
        sun: { DEFAULT: c('sun'), ink: c('sun-ink'), light: c('sun-light') },
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-body)', 'system-ui', 'sans-serif'],
      },
      borderRadius: { xl2: '1.25rem' },
    },
  },
  plugins: [],
};
export default config;
