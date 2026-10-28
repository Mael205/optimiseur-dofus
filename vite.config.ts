import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Sous-dossier du site en ligne (GitHub Pages : /optimiseur-dofus/), fourni par scripts/deploy.ts.
  base: process.env.BASE_PATH ?? "/",
  worker: { format: "es" },
  test: { environment: "node" },
} as never);
