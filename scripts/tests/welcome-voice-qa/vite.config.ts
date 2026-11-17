import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  root: "scripts/tests/welcome-voice-qa",
  plugins: [react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 5179, strictPort: true },
});
