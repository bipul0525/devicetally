import preact from '@preact/preset-vite'
import { defineConfig } from 'vite'

// Tauri serves dist/; dev server on a fixed port for `tauri dev`.
export default defineConfig({ plugins: [preact()], server: { port: 1420, strictPort: true }, clearScreen: false })
