import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "coverage", "node_modules"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: [".claude/hooks/**/*.js", "scripts/**/*.js"],
    languageOptions: {
      globals: globals.node,
    },
  },
)