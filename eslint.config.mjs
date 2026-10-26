// ESLint (flat config): the recommended rules and stricter ones.  The app's files are classic
// scripts sharing the page's global scope; each names what it takes from the others in a
// "global" comment and what it gives in an "exported" comment.
import js from "@eslint/js";
import globals from "globals";

const strict = {
  eqeqeq: "error",
  curly: "error",
  "no-var": "error",
  "prefer-const": "error",
  "no-shadow": "error",
  "no-use-before-define": ["error", { functions: false, classes: true, variables: true }],
  "consistent-return": "error",
  "default-case": "error",
  "default-param-last": "error",
  "dot-notation": "error",
  "no-else-return": "error",
  "no-lonely-if": "error",
  "no-useless-return": "error",
  "no-param-reassign": "error",
  "no-console": "error",
  "no-alert": "off",
  "no-implicit-coercion": "error",
  "no-throw-literal": "error",
  "no-unneeded-ternary": "error",
  "no-useless-concat": "error",
  "object-shorthand": "error",
  "prefer-arrow-callback": "error",
  "prefer-template": "error",
  radix: "error",
  "no-unused-vars": ["error", { vars: "all", args: "after-used", argsIgnorePattern: "^_", caughtErrors: "all" }],
  complexity: ["error", 25],
  "max-depth": ["error", 4],
  "max-params": ["error", 6],
};

export default [
  { ignores: ["vendor/**", "node_modules/**"] },
  js.configs.recommended,
  {
    files: ["js/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "script", globals: { ...globals.browser } },
    rules: strict,
  },
  {
    files: ["tests/**/*.mjs", "eslint.config.mjs"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: { ...globals.node } },
    rules: { ...strict, "no-console": "off" },
  },
];
