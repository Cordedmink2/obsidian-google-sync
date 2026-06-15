import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

function readJson(path) {
    return JSON.parse(readFileSync(path, "utf8"));
}

const manifest = readJson("manifest.json");
const pkg = readJson("package.json");
const lock = readJson("package-lock.json");
const versions = readJson("versions.json");
const version = manifest.version;
const errors = [];

if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
    errors.push(`manifest.json version must be plain semver x.y.z; got ${version}`);
}
if (pkg.version !== version) {
    errors.push(`package.json version ${pkg.version} does not match manifest.json ${version}`);
}
if (lock.version !== version) {
    errors.push(
        `package-lock.json version ${lock.version} does not match manifest.json ${version}`,
    );
}
if (lock.packages?.[""]?.version !== version) {
    errors.push(
        `package-lock root package version ${lock.packages?.[""]?.version} does not match manifest.json ${version}`,
    );
}
if (versions[version] !== manifest.minAppVersion) {
    errors.push(`versions.json missing ${version}: ${manifest.minAppVersion}`);
}

try {
    execFileSync("git", ["rev-parse", "--verify", `refs/tags/${version}`], { stdio: "ignore" });
    if (process.env.ALLOW_EXISTING_RELEASE_TAG !== "1") {
        errors.push(`git tag ${version} already exists; bump before releasing`);
    }
} catch {
    // Expected before release.
}

if (errors.length) {
    console.error(errors.map((e) => `✗ ${e}`).join("\n"));
    process.exit(1);
}
console.log(`Release metadata ok for ${version}`);
