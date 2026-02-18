import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        /* ===== CORPORATE SURFACES ===== */
        page: "var(--corp-bg-page)",
        surface: "var(--corp-bg-surface)",
        elevated: "var(--corp-bg-elevated)",
        soft: "var(--corp-bg-soft)",
        /* ===== CORPORATE TEXT ===== */
        "corp-text": {
          main: "var(--corp-text-main)",
          muted: "var(--corp-text-muted)",
          soft: "var(--corp-text-soft)",
        },
        /* ===== CORPORATE BORDERS ===== */
        "corp-border": {
          soft: "var(--corp-border-soft)",
          strong: "var(--corp-border-strong)",
        },
        /* ===== CORPORATE BRAND ===== */
        "corp-primary": {
          soft: "var(--corp-primary-soft)",
          hover: "var(--corp-primary-hover)",
        },
        /* ===== SEMANTIC STATUS ===== */
        status: {
          success: "var(--corp-success)",
          "success-soft": "var(--corp-success-soft)",
          warning: "var(--corp-warning)",
          "warning-soft": "var(--corp-warning-soft)",
          danger: "var(--corp-danger)",
          "danger-soft": "var(--corp-danger-soft)",
          neutral: "var(--corp-neutral)",
          "neutral-soft": "var(--corp-neutral-soft)",
        },
        /* ===== DUTY BADGES ===== */
        duty: {
          night: "var(--duty-night)",
          "night-bg": "var(--duty-night-bg)",
          morning: "var(--duty-morning)",
          "morning-bg": "var(--duty-morning-bg)",
          afternoon: "var(--duty-afternoon)",
          "afternoon-bg": "var(--duty-afternoon-bg)",
          leave: "var(--duty-leave)",
          "leave-bg": "var(--duty-leave-bg)",
          off: "var(--duty-off)",
          "off-bg": "var(--duty-off-bg)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
