import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { HeadlessGitConfig } from "./config";

const execFileAsync = promisify(execFile);

export type GitRunner = (args: string[]) => Promise<string>;

/**
 * Git integration for the headless sync. Strategy:
 *
 * - pre-sync: commit any leftover dirty tree (crash recovery), fetch, fast-forward; if
 *   the branches diverged try a rebase, and if that conflicts give up local history and
 *   hard-reset to the remote — safe at this point, because the run that follows
 *   regenerates everything Google-derived anyway.
 * - post-sync: stage the synced folders + state, commit, push; a rejected push retries
 *   (up to 3x) with `rebase -X theirs` so the fresh sync commit wins conflicting hunks.
 *   Never force-pushes: on exhaustion the run exits non-zero and the next run's
 *   pre-sync recovers cleanly.
 */
export class GitSync {
    private readonly run: GitRunner;

    constructor(
        private readonly vaultPath: string,
        private readonly cfg: HeadlessGitConfig,
        private readonly log: (msg: string) => void = () => {},
        runner?: GitRunner,
    ) {
        this.run =
            runner ??
            (async (args) => {
                const { stdout } = await execFileAsync("git", args, {
                    cwd: this.vaultPath,
                    maxBuffer: 16 * 1024 * 1024,
                });
                return stdout.trim();
            });
    }

    private commitArgs(message: string): string[] {
        return [
            "-c",
            `user.name=${this.cfg.authorName}`,
            "-c",
            `user.email=${this.cfg.authorEmail}`,
            "commit",
            "-m",
            message,
        ];
    }

    async branch(): Promise<string> {
        if (this.cfg.branch) return this.cfg.branch;
        return this.run(["rev-parse", "--abbrev-ref", "HEAD"]);
    }

    private async isDirty(): Promise<boolean> {
        return (await this.run(["status", "--porcelain"])) !== "";
    }

    async preSync(): Promise<void> {
        const branch = await this.branch();
        if (await this.isDirty()) {
            this.log("git: committing leftover uncommitted changes");
            await this.run(["add", "-A"]);
            await this.run(this.commitArgs("google-sync: recover uncommitted changes"));
        }
        try {
            await this.run(["fetch", this.cfg.remote, branch]);
        } catch (e) {
            // Offline is not fatal: sync against the local state, push will catch up later.
            this.log(
                `git: fetch failed (${(e as Error).message.split("\n")[0]}); continuing offline`,
            );
            return;
        }
        const upstream = `${this.cfg.remote}/${branch}`;
        try {
            await this.run(["merge", "--ff-only", upstream]);
        } catch {
            this.log("git: branches diverged — rebasing onto the remote");
            try {
                await this.run(["rebase", upstream]);
            } catch {
                this.log("git: rebase conflicted — resetting to the remote (sync regenerates)");
                await this.run(["rebase", "--abort"]).catch(() => undefined);
                await this.run(["reset", "--hard", upstream]);
            }
        }
    }

    /** Stage the given vault-relative paths, commit if anything changed, push with retry. */
    async commitAndPush(paths: string[], message: string): Promise<void> {
        const branch = await this.branch();
        await this.run(["add", "-A", "--", ...paths]);
        const staged = await this.run(["diff", "--cached", "--name-only"]);
        if (staged !== "") {
            await this.run(this.commitArgs(message));
            this.log(`git: committed ${staged.split("\n").length} file(s)`);
        } else {
            this.log("git: nothing to commit");
        }
        // Push even when this run committed nothing — a previous run may have
        // committed and then failed to push.
        const upstream = `${this.cfg.remote}/${branch}`;
        for (let attempt = 1; ; attempt++) {
            try {
                await this.run(["push", this.cfg.remote, `HEAD:${branch}`]);
                return;
            } catch (e) {
                if (attempt >= 3) {
                    throw new Error(
                        `git push failed after ${attempt} attempts: ${(e as Error).message.split("\n")[0]}`,
                    );
                }
                this.log("git: push rejected — rebasing onto the remote (ours wins) and retrying");
                await this.run(["fetch", this.cfg.remote, branch]);
                try {
                    // During a rebase "theirs" refers to the commits being replayed —
                    // i.e. our fresh sync commit — so freshly synced Google state wins
                    // any conflicting hunk. Never force-push.
                    await this.run(["rebase", "-X", "theirs", upstream]);
                } catch {
                    await this.run(["rebase", "--abort"]).catch(() => undefined);
                    throw new Error("git: rebase onto the remote failed; next run will recover");
                }
            }
        }
    }
}
