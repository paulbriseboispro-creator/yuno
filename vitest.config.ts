import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Config de test = celle de l'app + une exclusion. Les worktrees des autres
// branches vivent dans .claude/worktrees/ du checkout principal : sans elle,
// `npx vitest run` y joue aussi leurs tests (et échoue sur leurs écarts).
// Fichier à part pour que le build Vite ne charge jamais vitest.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      exclude: [...configDefaults.exclude, ".claude/worktrees/**"],
    },
  }),
);
