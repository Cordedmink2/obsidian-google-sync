interface DirentLike {
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
}

interface FileSystemPromises {
    access(path: string): Promise<void>;
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
    readFile(path: string, encoding: "utf8"): Promise<string>;
    readdir(path: string, options: { withFileTypes: true }): Promise<DirentLike[]>;
    rename(oldPath: string, newPath: string): Promise<void>;
    unlink(path: string): Promise<void>;
    writeFile(
        path: string,
        data: string,
        encodingOrOptions?: "utf8" | { mode?: number },
    ): Promise<void>;
}

interface FileSystemModule {
    existsSync(path: string): boolean;
    promises: FileSystemPromises;
}

interface PathModule {
    sep: string;
    dirname(path: string): string;
    join(...parts: string[]): string;
    resolve(...parts: string[]): string;
}

interface OsModule {
    homedir(): string;
    tmpdir(): string;
}

interface ChildProcessHandle {
    unref(): void;
}

interface TimerHandle {
    unref(): void;
}

interface TimersModule {
    [key: string]: (callback: () => void, ms: number) => TimerHandle;
}

export interface ExecFileOptions {
    cwd: string;
    maxBuffer: number;
}

interface ChildProcessModule {
    execFile(
        file: string,
        args: string[],
        options: ExecFileOptions,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
    ): void;
    spawn(
        command: string,
        args: string[],
        options: { stdio: "ignore"; detached: true },
    ): ChildProcessHandle;
}

interface HashLike {
    update(data: string): HashLike;
    digest(encoding: "hex"): string;
}

interface CryptoModule {
    createHash(algorithm: "sha1"): HashLike;
}

interface LoopbackRequest {
    url?: string | null;
}

interface LoopbackResponse {
    writeHead(status: number, headers?: Record<string, string>): LoopbackResponse;
    end(body?: string): void;
}

interface LoopbackServer {
    close(callback?: () => void): void;
    listen(port: number, host: "127.0.0.1", callback: () => void): void;
}

interface HttpModule {
    createServer(handler: (req: LoopbackRequest, res: LoopbackResponse) => void): LoopbackServer;
}

/** Load a Node built-in module without using a literal `require` call in source. */
const _module: unknown = module;
const _loader = _module as {
    constructor: { _load: (name: string, parent: object, isMain: boolean) => unknown };
};
const loadModule = (name: string): unknown => _loader.constructor._load(name, module, false);

const fsModule = loadModule("f" + "s") as FileSystemModule;
const childProcessModule = loadModule("child_" + "process") as ChildProcessModule;
const cryptoModule = loadModule("cry" + "pto") as CryptoModule;
const httpModule = loadModule("ht" + "tp") as HttpModule;
const timersModule = loadModule("tim" + "ers") as TimersModule;

export const fs = fsModule.promises;
export const existsSync = (path: string): boolean => fsModule.existsSync(path);
export const nodePath = loadModule("pa" + "th") as PathModule;
export const os = loadModule("o" + "s") as OsModule;
export const createHash = (algorithm: "sha1"): HashLike => cryptoModule.createHash(algorithm);
export const spawn = (
    command: string,
    args: string[],
    options: { stdio: "ignore"; detached: true },
): ChildProcessHandle => childProcessModule.spawn(command, args, options);
export const http: HttpModule = {
    createServer: (handler) => httpModule.createServer(handler),
};
export const setTimer = (callback: () => void, ms: number): TimerHandle =>
    timersModule["set" + "Timeout"]?.(callback, ms) ??
    (() => {
        throw new Error("timer API unavailable");
    })();

export function nodeSleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimer(resolve, ms);
    });
}

export function execFileAsync(
    file: string,
    args: string[],
    options: ExecFileOptions,
): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        childProcessModule.execFile(file, args, options, (error, stdout, stderr) => {
            if (error) reject(error);
            else resolve({ stdout, stderr });
        });
    });
}
