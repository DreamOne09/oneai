import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
// 使用 injectManifest 以套用自訂 service worker (src/sw.ts) 處理 Web Push。
export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            strategies: 'injectManifest',
            srcDir: 'src',
            filename: 'sw.ts',
            registerType: 'autoUpdate',
            injectRegister: 'auto',
            devOptions: { enabled: true, type: 'module' },
            manifest: {
                name: 'OneAI',
                short_name: 'OneAI',
                description: '李孟一的隨身 AI 主控台',
                theme_color: '#05060a',
                background_color: '#05060a',
                display: 'standalone',
                orientation: 'portrait',
                start_url: '/',
                icons: [
                    { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
                    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
                    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
                ]
            }
        })
    ],
    server: { host: true, port: 5173 }
});
