import { readFileSync } from "node:fs";

const bundle = readFileSync("main.js", "utf8");
const forbidden = [
    "node:fs",
    "node:path",
    "node:process",
    "node:child_process",
    "node:http",
    "headless/",
];

const hits = forbidden.filter((needle) => bundle.includes(needle));
if (hits.length) {
    console.error(`Runtime bundle contains forbidden Node/headless references: ${hits.join(", ")}`);
    process.exit(1);
}
console.log("Runtime bundle has no Node/headless references.");
