import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
const root = fileURLToPath(new URL("../..", import.meta.url));
// Isolated synthetic visual QA only. This does not exercise GoTrue, RLS or real feeds.
export default defineConfig({
  root,
  cacheDir: resolve(tmpdir(), "syncai-context-ui-qa-vite-cache"),
  plugins: [
    {
      name: "isolated-context-visual-qa",
      enforce: "pre",
      resolveId(id) {
        if (id === "virtual:context-qa") return "\0context-qa";
        if (id.endsWith("/AuthProvider")) return "\0context-auth-qa";
        if (id.endsWith("/syncContextService")) return "\0context-service-qa";
      },
      load(id) {
        if (id === "\0context-auth-qa")
          return `export function useAuth(){return {user:{id:'actor-a'},profile:{id:'actor-a',role:'admin',organization_id:'org-a'},session:{access_token:'synthetic-visual-only'},loading:false}}`;
        if (id === "\0context-service-qa")
          return `import {contextOperatingFixture} from '/src/test/support/syncContextOperatingFixture.ts'; export async function getSyncContextOperatingPicture(){const p=contextOperatingFixture();p.objects.push({...p.objects[0],id:'synthetic-boundary',name:'Synthetic boundary with hole',kind:'geofence',layerId:'hazards_geofences',geometryType:'Polygon',geometry:{type:'Polygon',coordinates:[[[-111.40,56.72],[-111.39,56.72],[-111.39,56.735],[-111.40,56.735],[-111.40,56.72]],[[-111.396,56.726],[-111.394,56.726],[-111.394,56.729],[-111.396,56.729],[-111.396,56.726]]]}});p.layers.push({...p.layers[0],id:'hazards_geofences',label:'Synthetic boundaries'});p.coverage.objects.eligible=p.coverage.objects.returned=2;return p}`;
        if (id === "\0context-qa")
          return `import React from 'react';import '/src/index.css';import '@fontsource-variable/inter';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import{SyncContextPage}from'/src/pages/SyncContextPage.tsx';import{OperatingSiteScopeContext}from'/src/components/sync-context/OperatingSiteScope.tsx';createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,null,React.createElement(OperatingSiteScopeContext.Provider,{value:{actorId:'actor-a',organizationId:'org-a',siteId:null,siteName:'Synthetic visual QA only'}},React.createElement(SyncContextPage))));`;
      },
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url !== "/context-visual-qa.html") return next();
          server
            .transformIndexHtml(
              "/context-visual-qa.html",
              `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sync Context — synthetic visual QA</title><style>html,body{margin:0;font-family:Arial,sans-serif}*{box-sizing:border-box}p{margin:8px 0}button{font:inherit}</style></head><body><div id="root"></div><script type="module" src="/@id/__x00__context-qa"></script></body></html>`,
            )
            .then((html) => {
              res.setHeader("Content-Type", "text/html");
              res.end(html);
            });
        });
      },
    },
    react(),
    tailwindcss(),
  ],
  server: {
    host: "127.0.0.1",
    port: 5189,
    strictPort: true,
    fs: { allow: [root, realpathSync(resolve(root, "node_modules"))] },
  },
});
