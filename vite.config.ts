import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { readFileSync } from "fs";

// Surfaced to the UI as __APP_VERSION__ so the About panel and package.json
// can never drift apart.
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "package.json"), "utf-8"),
) as { version: string };

// @tauri-apps/cli sets TAURI_DEV_HOST when serving to a physical device.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],

  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },

  // Keep Rust compiler errors readable in the terminal.
  clearScreen: false,

  server: {
    port: 1430,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1431 } : undefined,
    watch: {
      // Tauri rebuilds the Rust side itself.
      ignored: ["**/src-tauri/**"],
    },
  },

  // Two entry points, one bundle: the desk window and the pop-up.
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        pop: resolve(__dirname, "pop.html"),
      },
    },
  },
});
