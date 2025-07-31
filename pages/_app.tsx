// pages/_app.tsx
import type { AppProps } from 'next/app'
import '../styles/globals.css'
import 'highlight.js/styles/github-dark.css'
import 'katex/dist/katex.min.css'
import '../styles/globals.css'
import { SpeedInsights } from "@vercel/speed-insights/next"
import { Analytics } from "@vercel/analytics/next"

// Import Highlight.js theme & KaTeX CSS here:
import 'highlight.js/styles/github-dark.css'
import 'katex/dist/katex.min.css'

export default function MyApp({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />
}