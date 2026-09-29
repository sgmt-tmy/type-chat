import eslint from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

// eslint-config-next は使わない。内部の eslint-plugin-react が ESLint 10 に未対応のため、
// Next.js 用ルールと react-hooks ルールをプラグインから直接組み込む（対応版が出たら見直す）。
export default tseslint.config(
  { ignores: ["dist", "coverage", "node_modules", ".next", "next-env.d.ts"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  nextPlugin.configs["core-web-vitals"],
  reactHooks.configs.flat.recommended,
  {
    files: [".claude/hooks/**/*.js", "scripts/**/*.js"],
    languageOptions: {
      globals: globals.node,
    },
  },
)
