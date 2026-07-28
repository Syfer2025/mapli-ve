import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import theatrum from "./tools/eslint-rules/index.mjs";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/out/**",
      "**/.vite/**",
      "**/coverage/**",
      "data/**",
      "tests/golden/frames/**",
      "scratchpad/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ---- Todo TypeScript do workspace ----
  //
  // Sem `projectService`: nenhuma regra ativa aqui usa informação de tipo — as
  // quatro regras do projeto são sintáticas e `tseslint.configs.recommended`
  // não é a variante type-checked. Exigir um projeto TS por arquivo só criaria
  // atrito (testes e configs de raiz vivem em projetos separados) sem ganho.
  //
  // TODO(fase-8): habilitar um bloco `recommendedTypeChecked` quando o
  // pipeline de export trouxer código assíncrono de verdade —
  // `no-floating-promises` e `no-misused-promises` valem o custo lá.
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: { theatrum },
    rules: {
      // Regras do projeto — ver docs/07-CONVENTIONS.md § 7
      "theatrum/no-cross-layer-import": "error",
      "theatrum/no-nondeterminism": "error",
      "theatrum/enforce-barrel-imports": "error",
      "theatrum/no-direct-document-mutation": "error",

      // `any` só com justificativa escrita
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "off", // ruidoso em fronteira de I/O
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-non-null-assertion": "error",

      // Nomes proibidos — se não dá nome ao que faz, faz coisas demais
      "no-restricted-syntax": [
        "error",
        {
          selector: "ClassDeclaration[id.name=/(Manager|Helper|Utils|Impl)$/]",
          message:
            "nome genérico de classe. Nomeie pelo que ela faz — Manager/Helper/Utils/Impl indica responsabilidade difusa.",
        },
        {
          selector: "TSInterfaceDeclaration[id.name=/^I[A-Z]/]",
          message: 'sem prefixo "I" em interface.',
        },
      ],

      // console só no sink de log
      "no-console": "error",

      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-param-reassign": "error",
      "prefer-const": "error",
      "object-shorthand": "error",
    },
  },

  // ---- Testes: mais folga ----
  {
    files: ["**/*.test.ts", "**/*.bench.ts", "tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-console": "off",
      "theatrum/no-nondeterminism": "off",
    },
  },

  // ---- Configs de raiz e scripts de tooling: rodam em Node ----
  {
    files: ["tools/**/*.{ts,mjs,js}", "*.{ts,js,mjs,cjs}", ".*.{js,mjs,cjs}"],
    languageOptions: {
      globals: { ...globals.node },
      sourceType: "module",
    },
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // ---- CommonJS: `module`/`require` são globais legítimos ----
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: { ...globals.node } },
  },

  // ---- Shell Electron: Node de verdade ----
  {
    files: ["apps/shell/**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
  },

  // ---- Editor: browser ----
  {
    files: ["apps/editor/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
  },
);
