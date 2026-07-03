import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#EFF6FF',
          100: '#DBEAFE',
          200: '#BFDBFE',
          300: '#93C5FD',
          400: '#60A5FA',
          500: '#3B82F6',
          600: '#2563EB',
          700: '#1D4ED8',
          800: '#1E40AF',
          900: '#1E3A8A',
          950: '#172554',
        },
        accent: {
          50: '#FFF7ED',
          100: '#FFEDD5',
          200: '#FED7AA',
          300: '#FDBA74',
          400: '#FB923C',
          500: '#F97316',
          600: '#EA580C',
          700: '#C2410C',
          800: '#9A3412',
        },
        surface: {
          light: '#F8FAFC',
          DEFAULT: '#F1F5F9',
          dark: '#0F172A',
          darker: '#020617',
        },
        manga: {
          bubble: '#FFFFFF',
          speech: '#F0F9FF',
          narration: '#FEFCE8',
          onomatopoeia: '#FFF7ED',
        },
        status: {
          pending: '#94A3B8',
          translating: '#3B82F6',
          reviewed: '#EAB308',
          completed: '#22C55E',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        manga: ['Noto Sans JP', 'Noto Sans SC', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      boxShadow: {
        'card': '0 1px 3px 0 rgb(0 0 0 / 0.04), 0 1px 2px -1px rgb(0 0 0 / 0.04)',
        'card-hover': '0 12px 28px -6px rgb(0 0 0 / 0.1), 0 4px 12px -8px rgb(0 0 0 / 0.08)',
        'card-xl': '0 16px 36px -10px rgb(0 0 0 / 0.12), 0 6px 16px -8px rgb(0 0 0 / 0.08)',
        'panel': '0 20px 48px -10px rgb(0 0 0 / 0.12), 0 4px 16px -6px rgb(0 0 0 / 0.06)',
        'glow': '0 0 24px -6px rgb(59 130 246 / 0.4)',
        'glow-lg': '0 0 48px -12px rgb(59 130 246 / 0.5)',
        'glow-accent': '0 0 24px -6px rgb(249 115 22 / 0.35)',
        'inner-glow': 'inset 0 2px 4px 0 rgb(0 0 0 / 0.04)',
        'inner-glow-lg': 'inset 0 2px 8px 0 rgb(0 0 0 / 0.06)',
        'elevated': '0 4px 16px -4px rgb(0 0 0 / 0.08), 0 2px 6px -2px rgb(0 0 0 / 0.04)',
        'dark-glow': '0 0 32px -8px rgb(147 197 253 / 0.2)',
        'dark-glow-lg': '0 0 56px -14px rgb(147 197 253 / 0.25)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'pulse-soft': 'pulseSoft 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float': 'float 6s ease-in-out infinite',
        'gradient-shift': 'gradientShift 8s ease infinite',
        'scale-in': 'scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        'border-glow': 'borderGlow 3s ease-in-out infinite',
        'shimmer': 'shimmerBg 2s ease-in-out infinite',
        'ripple': 'ripple 0.6s ease-out',
        'pop-in': 'popIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.75' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        gradientShift: {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        borderGlow: {
          '0%, 100%': { borderColor: 'rgb(59 130 246 / 0.3)' },
          '50%': { borderColor: 'rgb(59 130 246 / 0.6)' },
        },
        shimmerBg: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        ripple: {
          '0%': { transform: 'scale(0)', opacity: '0.5' },
          '100%': { transform: 'scale(4)', opacity: '0' },
        },
        popIn: {
          '0%': { opacity: '0', transform: 'scale(0.9)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'mesh-gradient': 'linear-gradient(135deg, var(--tw-gradient-stops))',
        'gradient-primary': 'linear-gradient(135deg, #3B82F6 0%, #2563EB 50%, #1D4ED8 100%)',
        'gradient-accent': 'linear-gradient(135deg, #F97316 0%, #EA580C 50%, #C2410C 100%)',
        'gradient-brand': 'linear-gradient(135deg, #3B82F6 0%, #6366F1 40%, #F97316 100%)',
        'gradient-subtle': 'linear-gradient(180deg, rgb(59 130 246 / 0.03) 0%, transparent 100%)',
        'gradient-card-dark': 'linear-gradient(180deg, rgb(30 41 59 / 0.6) 0%, rgb(15 23 42 / 0.8) 100%)',
      },
      transitionTimingFunction: {
        'bounce-sm': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        'spring': 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
      },
    },
  },
  plugins: [],
};
export default config;
