import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  {
    // 스파이크 하네스와 **남의 산출물**은 린트 대상이 아니다.
    // public/engine 의 글루는 Emscripten 이 낸 것이라 우리 규칙을 적용할 대상이
    // 아니고, 실제로 210개를 쏟아낸다.
    // bench/ 는 브라우저·노드를 오가는 측정 하네스라 spike 와 같이 다룬다.
    ignores: [
      "dist",
      "out",
      "out-diag",
      "results",
      "spike",
      "bench",
      "public",
      "src/styles/tokens.css",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // tools/*.mjs 는 노드에서만 도는 빌드 · 측정 도우미다(예: config_set.mjs) — console · process 를 안다.
    files: ["tools/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
);
