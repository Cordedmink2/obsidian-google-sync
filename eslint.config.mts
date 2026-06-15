import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";
import { globalIgnores } from "eslint/config";

export default defineConfig(
    {
        languageOptions: {
            globals: {
                ...globals.browser,
            },
            parserOptions: {
                projectService: {
                    allowDefaultProject: ["eslint.config.js", "manifest.json"],
                },
                tsconfigRootDir: import.meta.dirname,
                extraFileExtensions: [".json"],
            },
        },
    },
    ...obsidianmd.configs.recommended,
    {
        // Google product names are valid sentence-case proper nouns for this plugin's UI.
        plugins: { obsidianmd },
        rules: {
            "obsidianmd/ui/sentence-case": [
                "error",
                {
                    brands: [
                        "Obsidian",
                        "Google Calendar",
                        "Google Tasks",
                        "Google Cloud",
                        "Google",
                        "OAuth",
                    ],
                    acronyms: ["ID", "URL", "API", "IANA", "UTC"],
                },
            ],
        },
    },
    {
        // Tests hard-delete files for deterministic cleanup; trashFile would litter .trash.
        files: ["test/**/*.ts"],
        languageOptions: { globals: { ...globals.node } },
        plugins: { obsidianmd },
        rules: {
            "import/no-nodejs-modules": "off",
            "no-undef": "off",
            "obsidianmd/prefer-file-manager-trash-file": "off",
        },
    },
    {
        // Node-only command-line tooling is not part of the Obsidian runtime bundle.
        files: ["headless/**/*.ts", "scripts/**/*.{js,cjs,mjs}"],
        languageOptions: { globals: { ...globals.node } },
        rules: {
            "import/no-nodejs-modules": "off",
            "no-console": "off",
            "no-restricted-globals": "off",
            "no-undef": "off",
            "obsidianmd/hardcoded-config-path": "off",
        },
    },
    eslintConfigPrettier,
    globalIgnores([
        "node_modules",
        "dist",
        "esbuild.config.mjs",
        "eslint.config.js",
        "version-bump.mjs",
        "versions.json",
        "main.js",
    ]),
);
