import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

const productionImports = [
  {
    regex: "(^|/)tests(/|$)",
    message: "Production code must not depend on tests.",
  },
  {
    regex: "^issue-runner-core(?:$|/(?!terminal$))",
    message: "Use only the public issue-runner-core/terminal contract.",
  },
];

export default defineConfig(
  { ignores: ["coverage/**", "dist/**"] },
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx,mts,cts}"],
    rules: {
      "max-lines": [
        "error",
        { max: 500, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [js.configs.recommended],
  },
  {
    files: ["src/**/*.{js,mjs,cjs,ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: productionImports }],
    },
  },
  {
    files: ["src/plugin/**/*.{js,mjs,cjs,ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...productionImports,
            {
              regex:
                "^(node:)?(fs|net|tls|http|https|http2|dns|dgram|child_process|cluster|worker_threads|readline|tty)(/|$)",
              message: "Keep backend I/O in src/herdr/.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/herdr/**/*.{js,mjs,cjs,ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...productionImports,
            {
              regex: "(^|/)plugin(/|$)",
              message: "The Herdr adapter must not depend on plugin semantics.",
            },
          ],
        },
      ],
    },
  },
);
