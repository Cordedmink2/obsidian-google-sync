import { describe, it } from "mocha";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

describe("tsconfig is TypeScript 6 ready", () => {
    const raw = fs.readFileSync(path.resolve(__dirname, "../../tsconfig.json"), "utf8");
    const opts = (JSON.parse(raw) as { compilerOptions: Record<string, unknown> }).compilerOptions;

    it("does not use baseUrl (deprecated in TS 6; nothing imports through it)", () => {
        expect(opts.baseUrl).to.equal(undefined);
    });

    it('uses moduleResolution "bundler", not the deprecated "node"', () => {
        expect(String(opts.moduleResolution).toLowerCase()).to.equal("bundler");
    });
});
