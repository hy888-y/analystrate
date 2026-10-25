import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// /api calls are forwarded to the Flask backend during development
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:5000' } },
});
