import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cadence: "src/cadence.ts" },
  format: "esm",
  platform: "node",
  target: "node20",
  clean: true,
  // bundle the workspace packages (they ship TS source, Node can't load that)
  noExternal: [/^@cadence\//],
});
