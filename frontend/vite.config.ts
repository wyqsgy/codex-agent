import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          codemirror: ['@codemirror/view', '@codemirror/state', '@codemirror/language', '@codemirror/commands'],
          'codemirror-lang': [
            '@codemirror/lang-javascript', '@codemirror/lang-python', '@codemirror/lang-java',
            '@codemirror/lang-cpp', '@codemirror/lang-go', '@codemirror/lang-rust',
            '@codemirror/lang-json', '@codemirror/lang-markdown',
          ],
          markdown: ['react-markdown', 'remark-gfm', 'highlight.js'],
        },
      },
    },
    chunkSizeWarningLimit: 800,
  },
})