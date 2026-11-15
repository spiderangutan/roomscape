import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Host names allowed to reach the dev server are supplied at start-up through
// ROOMSCAPE_ALLOWED_HOSTS (comma separated) so no environment-specific host
// name is written into the repository.
const allowedHosts = (process.env.ROOMSCAPE_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean)

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 3000,
    strictPort: true,
    ...(allowedHosts.length ? { allowedHosts } : {}),
  },
  preview: {
    host: true,
    port: 3000,
  },
})
