import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  /* Относительные пути к ресурсам: приложение одинаково работает и в корне
   * домена, и в подкаталоге вроде /DIY-furniture/ на GitHub Pages, и просто
   * из папки на диске. Клиентского роутинга здесь нет — разделы это состояние
   * внутри страницы, — поэтому относительная база безопасна и не требует
   * ни SPA-заглушки, ни привязки сборки к конкретному адресу. */
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
