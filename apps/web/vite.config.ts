import { defineConfig } from "vite";

export default defineConfig({
  // kit sample assets live outside the app root, inside the monorepo
  server: { fs: { allow: ["../.."] } },
});
