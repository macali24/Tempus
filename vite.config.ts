import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/npi': {
        target: 'https://npiregistry.cms.hhs.gov',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/npi/, '/api/'),
      },
    },
  },
});
