import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'

import app from './server/app'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      configureServer(server) {
        server.middlewares.use(app)
      },
      name: 'api-server'
    }
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
})
