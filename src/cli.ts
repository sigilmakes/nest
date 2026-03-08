#!/usr/bin/env node
/**
 * nest — CLI entry point
 *
 * Commands:
 *   nest                                Attach TUI (default)
 *   nest init [name]                    Create a new workspace
 *   nest start                          Start kernel foreground (bare metal)
 *   nest status                         Show workspace info
 *   nest list                           List known workspaces
 *
 * Options:
 *   -w, --workspace <name|path>         Select workspace
 *   -s, --session <name>                Select session
 *   -c, --config <path>                 Explicit config file (for start)
 *   -h, --help                          Show help
 *   -v, --version                       Show version
 */

import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const __srcDir = dirname(fileURLToPath(import.meta.url));

// ─── Workspace Registry ─────────────────────────────────────

const NEST_HOME = join(homedir(), ".nest");
const REGISTRY_PATH = join(NEST_HOME, "workspaces.json");

interface WorkspaceRegistry {
    workspaces: Record<string, string>; // name -> absolute path
    default?: string;
}

function loadRegistry(): WorkspaceRegistry {
    try {
        if (existsSync(REGISTRY_PATH)) {
            return JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
        }
    } catch {}
    return { workspaces: {} };
}

function saveRegistry(registry: WorkspaceRegistry): void {
    mkdirSync(NEST_HOME, { recursive: true });
    writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n", "utf-8");
}

export function registerWorkspace(name: string, path: string): void {
    const registry = loadRegistry();
    registry.workspaces[name] = resolve(path);
    if (!registry.default) {
        registry.default = name;
    }
    saveRegistry(registry);
}

function resolveWorkspace(nameOrPath?: string): { path: string; name?: string } | null {
    if (!nameOrPath) {
        // Try current directory first
        const cwd = process.cwd();
        if (existsSync(join(cwd, "config.yaml"))) {
            const registry = loadRegistry();
            const resolvedCwd = resolve(cwd);
            const match = Object.entries(registry.workspaces).find(([, p]) => resolve(p) === resolvedCwd);
            return { path: cwd, name: match?.[0] };
        }

        // Try default workspace from registry
        const registry = loadRegistry();
        if (registry.default) {
            const p = registry.workspaces[registry.default];
            if (p && existsSync(join(p, "config.yaml"))) {
                return { path: p, name: registry.default };
            }
        }

        // Fallback: single workspace in ~/.nest/
        const nestHome = join(homedir(), ".nest");
        if (existsSync(nestHome)) {
            try {
                const dirs = readdirSync(nestHome).filter(
                    (d) => existsSync(join(nestHome, d, "config.yaml")),
                );
                if (dirs.length === 1) {
                    return { path: join(nestHome, dirs[0]), name: dirs[0] };
                }
            } catch {}
        }
        return null;
    }

    // Check registry first
    const registry = loadRegistry();
    const registered = registry.workspaces[nameOrPath];
    if (registered && existsSync(join(registered, "config.yaml"))) {
        return { path: registered, name: nameOrPath };
    }

    // Try as ~/.nest/<name>
    const asNestDir = join(homedir(), ".nest", nameOrPath);
    if (existsSync(join(asNestDir, "config.yaml"))) {
        return { path: asNestDir, name: nameOrPath };
    }

    // Try as absolute/relative path
    const asPath = resolve(nameOrPath);
    if (existsSync(join(asPath, "config.yaml"))) {
        return { path: asPath };
    }

    return null;
}

// ─── Help ───────────────────────────────────────────────────

function printHelp(): void {
    console.log(`
  🪺 nest — minimal agent gateway

  Commands:
    nest                                 Attach TUI to running instance
    nest init [name]                     Create a new workspace
    nest start                           Start kernel foreground (bare metal)
    nest status                          Show workspace info
    nest list                            List known workspaces

  Options:
    -w, --workspace <name|path>          Select workspace
    -s, --session <name>                 Select session
    -c, --config <path>                  Explicit config file (for start)
    -h, --help                           Show this help
    -v, --version                        Show version

  Examples:
    nest                                 Attach to default workspace
    nest -w wren                         Attach to named workspace
    nest -w wren -s background           Attach to specific session
    nest init                            Create workspace interactively
    nest start                           Start bare metal (foreground)
    nest start -c ./config.yaml          Start with explicit config
`.trimEnd());
}

function printVersion(): void {
    try {
        const pkg = JSON.parse(
            readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
        );
        console.log(`nest ${pkg.version}`);
    } catch {
        console.log("nest (unknown version)");
    }
}

// ─── Arg Parsing ────────────────────────────────────────────

interface ParsedArgs {
    command: "attach" | "init" | "start" | "status" | "list" | "help" | "version";
    workspace?: string;
    session?: string;
    config?: string;
    rest: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
    const args = argv.slice(2);
    let command: ParsedArgs["command"] = "attach";
    let workspace: string | undefined;
    let session: string | undefined;
    let config: string | undefined;
    const rest: string[] = [];
    let hasExplicitCommand = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === "init" && !hasExplicitCommand) {
            command = "init";
            hasExplicitCommand = true;
        } else if (arg === "start" && !hasExplicitCommand) {
            command = "start";
            hasExplicitCommand = true;
        } else if (arg === "status" && !hasExplicitCommand) {
            command = "status";
            hasExplicitCommand = true;
        } else if (arg === "list" && !hasExplicitCommand) {
            command = "list";
            hasExplicitCommand = true;
        } else if (arg === "--help" || arg === "-h") {
            command = "help";
            hasExplicitCommand = true;
        } else if (arg === "--version" || arg === "-v") {
            command = "version";
            hasExplicitCommand = true;
        } else if (arg === "--workspace" || arg === "-w") {
            workspace = args[++i];
        } else if (arg === "--session" || arg === "-s") {
            session = args[++i];
        } else if (arg === "--config" || arg === "-c") {
            config = args[++i];
        } else {
            rest.push(arg);
        }
    }

    return { command, workspace, session, config, rest };
}

// ─── Commands ───────────────────────────────────────────────

async function cmdInit(args: ParsedArgs): Promise<void> {
    const nameHint = args.rest[0];

    const { runInitWizard } = await import("./init.js");
    const result = await runInitWizard(nameHint);

    if (result) {
        registerWorkspace(result.instanceName, result.nestDir);
    }
}

async function cmdAttach(args: ParsedArgs): Promise<void> {
    const workspace = resolveWorkspace(args.workspace);
    if (!workspace) {
        if (args.workspace) {
            console.error(`Error: workspace "${args.workspace}" not found`);
        } else {
            console.error("No workspace found.");
        }

        // List known workspaces as hint
        const registry = loadRegistry();
        const names = Object.keys(registry.workspaces);
        if (names.length > 0) {
            console.error(`\nKnown workspaces: ${names.join(", ")}`);
            console.error(`Use: nest -w <name>`);
        } else {
            console.error('Run "nest init" to create a workspace.');
        }
        process.exit(1);
    }

    const { loadConfigRaw } = await import("./config.js");
    const configPath = join(workspace.path, "config.yaml");
    const config = loadConfigRaw(configPath);

    if (!config.server) {
        console.error("Error: no server configured in config.yaml (need server.port and server.token)");
        process.exit(1);
    }

    const port = config.server.port;
    const host = config.attach?.host ?? "127.0.0.1";
    const token = process.env.SERVER_TOKEN ?? config.server.token;

    // Resolve token from .env file if it's an env: reference
    let resolvedToken = token;
    if (typeof token === "string" && token.startsWith("env:")) {
        const envName = token.slice(4);
        resolvedToken = process.env[envName] ?? "";
        if (!resolvedToken) {
            const envPath = join(workspace.path, ".env");
            if (existsSync(envPath)) {
                const envFile = readFileSync(envPath, "utf-8");
                const match = envFile.match(new RegExp(`^${envName}=(.+)$`, "m"));
                if (match) resolvedToken = match[1].trim().replace(/^["']|["']$/g, "");
            }
        }
        if (!resolvedToken) {
            console.error(`Error: environment variable ${envName} not set`);
            process.exit(1);
        }
    }

    const wsUrl = `ws://${host}:${port}/cli`;

    const { default: WebSocket } = await import("ws");
    const ws = new WebSocket(wsUrl);

    ws.on("open", () => {
        const username = process.env.USER ?? "cli";
        ws.send(JSON.stringify({ type: "auth", token: resolvedToken, username }));
    });

    ws.on("message", (rawData) => {
        let msg: any;
        try { msg = JSON.parse(rawData.toString()); } catch { return; }

        if (msg.type === "auth_ok") {
            import("./attach-tui.js").then(({ startTui }) => {
                startTui(ws, workspace.name ?? "nest", wsUrl);
            });
        } else if (msg.type === "auth_fail") {
            console.error("Authentication failed");
            process.exit(1);
        }
    });

    ws.on("close", () => {
        console.error("Connection closed");
        process.exit(1);
    });

    ws.on("error", () => {
        const composePath = join(workspace.path, "docker-compose.yml");
        const name = workspace.name ?? workspace.path;

        console.error(`Nest is not running (can't connect to ${wsUrl})`);
        console.error();

        if (existsSync(composePath)) {
            console.error(`Start with: docker compose -f ${composePath} up -d`);
        } else {
            const flag = workspace.name ? ` -w ${workspace.name}` : "";
            console.error(`Start with: nest start${flag}`);
        }
        process.exit(1);
    });
}

async function cmdStart(args: ParsedArgs): Promise<void> {
    // Explicit --config: run bare-metal from that path
    if (args.config) {
        const configPath = resolve(args.config);
        if (!existsSync(configPath)) {
            console.error(`Error: config file not found: ${configPath}`);
            process.exit(1);
        }
        await startBareMetal({ path: dirname(configPath) }, configPath);
        return;
    }

    const ws = resolveWorkspace(args.workspace);
    if (!ws) {
        console.error(args.workspace
            ? `Error: workspace "${args.workspace}" not found`
            : "Error: no workspace found");
        console.error('Run "nest init" to create a workspace, or "nest list" to see known workspaces');
        process.exit(1);
    }

    // Docker workspace — don't try to start bare metal
    const composePath = join(ws.path, "docker-compose.yml");
    if (existsSync(composePath)) {
        console.error("This is a Docker workspace. Start with:");
        console.error(`  docker compose -f ${composePath} up -d`);
        process.exit(1);
    }

    const configPath = join(ws.path, "config.yaml");
    if (ws.name) {
        registerWorkspace(ws.name, ws.path);
    }

    await startBareMetal(ws, configPath);
}

async function startBareMetal(
    ws: { path: string; name?: string },
    configPath: string,
): Promise<void> {
    process.chdir(ws.path);

    if (ws.name) {
        console.log(`Starting workspace "${ws.name}" (${ws.path})`);
    }

    const { loadConfig } = await import("./config.js");
    const { Kernel } = await import("./kernel.js");
    const { Bridge } = await import("./bridge.js");
    const { SessionManager } = await import("./session-manager.js");
    const logger = await import("./logger.js");

    const config = loadConfig(configPath);

    function createBridge(opts: { cwd: string; command?: string; args?: string[] }) {
        const sessionConfig = Object.values(config.sessions).find(
            (s) => s.pi.cwd === opts.cwd,
        );
        const agentDir = sessionConfig?.pi.agentDir ?? config.instance?.agentDir;
        const env: Record<string, string> = {};
        if (agentDir) {
            env.PI_CODING_AGENT_DIR = resolve(agentDir);
        }

        return new Bridge({
            cwd: opts.cwd,
            command: opts.command,
            args: opts.args ?? ["--mode", "rpc", "--continue"],
            ...(Object.keys(env).length > 0 ? { env } : {}),
        });
    }

    const sessionManager = new SessionManager(config, createBridge);
    const kernel = new Kernel(config, sessionManager);

    const shutdown = () => {
        kernel.stop().then(() => process.exit(0));
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);

    kernel.start().catch((err) => {
        logger.error("Failed to start", { error: String(err) });
        process.exit(1);
    });
}

async function cmdStatus(args: ParsedArgs): Promise<void> {
    const ws = resolveWorkspace(args.workspace);
    if (!ws) {
        console.error(args.workspace
            ? `Error: workspace "${args.workspace}" not found`
            : "Error: no workspace found");
        process.exit(1);
    }

    const { loadConfigRaw } = await import("./config.js");
    const config = loadConfigRaw(join(ws.path, "config.yaml"));

    const sessions = Object.keys(config.sessions);
    const agentDir = config.instance?.agentDir
        ? resolve(ws.path, config.instance.agentDir)
        : "~/.pi/agent (shared)";
    const pluginsRel = config.instance?.pluginsDir ?? "./plugins";
    const pluginsDir = resolve(ws.path, pluginsRel);

    let pluginCount = 0;
    if (existsSync(pluginsDir)) {
        pluginCount = readdirSync(pluginsDir).filter(
            (f) => existsSync(join(pluginsDir, f, "nest.ts")) || existsSync(join(pluginsDir, f, "pi.ts")),
        ).length;
    }

    const cronDir = config.cron?.dir ? resolve(ws.path, config.cron.dir) : null;
    let cronCount = 0;
    if (cronDir && existsSync(cronDir)) {
        cronCount = readdirSync(cronDir).filter((f) => f.endsWith(".md")).length;
    }

    const isDocker = existsSync(join(ws.path, "docker-compose.yml"));

    console.log(`
  🪺 nest workspace${ws.name ? `: ${ws.name}` : ""}
  ${ws.path}

  Instance:    ${config.instance?.name ?? "nest"}
  Mode:        ${isDocker ? "Docker" : "bare metal"}
  Agent dir:   ${agentDir}
  Sessions:    ${sessions.join(", ")} (default: ${config.defaultSession})
  Plugins:     ${pluginCount} in ${pluginsRel}
  Server:      ${config.server ? `http://${config.server.host ?? "127.0.0.1"}:${config.server.port}` : "disabled"}
  Cron:        ${cronDir ? `${cronCount} job(s) in ${config.cron!.dir}` : "disabled"}
`.trimEnd());
    console.log();
}

async function cmdList(): Promise<void> {
    const registry = loadRegistry();
    const names = Object.keys(registry.workspaces);

    if (names.length === 0) {
        console.log("\n  No workspaces registered.");
        console.log('  Run "nest init" to create one.\n');
        return;
    }

    console.log("\n  🪺 nest workspaces\n");
    for (const name of names.sort()) {
        const wsPath = registry.workspaces[name];
        const exists = existsSync(join(wsPath, "config.yaml"));
        const isDefault = name === registry.default;
        const marker = isDefault ? " (default)" : "";
        const status = exists ? "✓" : "✗ missing";
        console.log(`  ${status}  ${name}${marker}`);
        console.log(`      ${wsPath}`);
    }
    console.log();
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
    const args = parseArgs(process.argv);

    switch (args.command) {
        case "help":
            printHelp();
            break;
        case "version":
            printVersion();
            break;
        case "init":
            await cmdInit(args);
            break;
        case "attach":
            await cmdAttach(args);
            break;
        case "start":
            await cmdStart(args);
            break;
        case "status":
            await cmdStatus(args);
            break;
        case "list":
            await cmdList();
            break;
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
