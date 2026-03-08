/**
 * UI tools extension for nest block protocol.
 *
 * Provides show_image, confirm, and select tools that communicate
 * with the nest kernel via HTTP to display rich content and collect
 * user input through the block protocol.
 *
 * Requires NEST_URL and SERVER_TOKEN environment variables.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

const NEST_URL = process.env.NEST_URL ?? "http://127.0.0.1:8484";
const NEST_TOKEN = process.env.SERVER_TOKEN ?? "";

async function postBlock(session: string, block: any, timeout?: number, origin?: { platform: string; channel: string }): Promise<any> {
    const res = await fetch(`${NEST_URL}/api/block`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${NEST_TOKEN}`,
        },
        body: JSON.stringify({ session, block, timeout, origin }),
    });
    return res.json();
}

const MIME: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
};

export default function (pi: ExtensionAPI) {

    // ─── show_image ──────────────────────────────────────

    pi.registerTool({
        name: "show_image",
        label: "Show Image",
        description: "Display an image inline in the user's terminal or chat.",
        parameters: Type.Object({
            path: Type.String({ description: "Absolute path to the image file" }),
            caption: Type.Optional(Type.String({ description: "Caption shown below the image" })),
        }),
        async execute(_id, params) {
            const data = await readFile(params.path);
            const ext = extname(params.path).toLowerCase();
            const mimeType = MIME[ext] ?? "image/png";
            const filename = basename(params.path);

            // Use binary upload to avoid base64 overhead in the request
            const form = new FormData();
            form.set("session", "default");
            form.set("id", `img-${Date.now()}`);
            form.set("filename", filename);
            form.set("mimeType", mimeType);
            form.set("fallback", `[Image: ${filename}${params.caption ? ` — ${params.caption}` : ""}]`);
            form.set("file", new Blob([data]), filename);

            const res = await fetch(`${NEST_URL}/api/block/upload`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${NEST_TOKEN}` },
                body: form,
            });
            const result = await res.json() as { ok: boolean; error?: string };

            return {
                content: [{ type: "text" as const, text: result.ok ? `Displayed ${filename}` : `Failed: ${result.error}` }],
            };
        },
    });

    // ─── confirm ─────────────────────────────────────────

    pi.registerTool({
        name: "confirm",
        label: "Confirm",
        description: "Ask the user a yes/no question. Returns true or false.",
        parameters: Type.Object({
            text: Type.String({ description: "The question to ask" }),
        }),
        async execute(_id, params) {
            const result = await postBlock("default", {
                id: `confirm-${Date.now()}`,
                kind: "confirm",
                data: { text: params.text },
                fallback: `${params.text} [y/n]`,
            }, 60_000);

            if (result.cancelled) {
                return { content: [{ type: "text" as const, text: "User cancelled." }] };
            }
            return {
                content: [{ type: "text" as const, text: result.value ? "User confirmed." : "User declined." }],
            };
        },
    });

    // ─── select ──────────────────────────────────────────

    pi.registerTool({
        name: "select",
        label: "Select",
        description: "Ask the user to choose from a list of options. Returns the selected value.",
        parameters: Type.Object({
            text: Type.String({ description: "Prompt text" }),
            options: Type.Array(Type.Object({
                value: Type.String(),
                label: Type.String(),
                description: Type.Optional(Type.String()),
            })),
        }),
        async execute(_id, params) {
            const result = await postBlock("default", {
                id: `select-${Date.now()}`,
                kind: "select",
                data: { text: params.text, items: params.options },
                fallback: `${params.text}\n${params.options.map((o: any, i: number) => `  ${i + 1}. ${o.label}`).join("\n")}`,
            }, 60_000);

            if (result.cancelled) {
                return { content: [{ type: "text" as const, text: "User cancelled." }] };
            }
            return {
                content: [{ type: "text" as const, text: `User selected: ${result.value}` }],
            };
        },
    });
}
