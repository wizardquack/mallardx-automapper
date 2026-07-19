import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // node env is fine — engine modules are pure; canvas draw is exercised
    // via computeLayout(), which takes no DOM.
    include: ["ui/**/*.test.js"],
  },
});
