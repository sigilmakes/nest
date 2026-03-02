import type { NestMessage, NestReply } from './types';

/**
 * ExtensionBridge handles postMessage from extension iframes.
 * It proxies API calls (with cookies) so extensions never see the auth token.
 */
export class ExtensionBridge {
    private stateStore = new Map<string, Map<string, unknown>>();

    constructor() {
        window.addEventListener('message', this.handleMessage);
    }

    destroy(): void {
        window.removeEventListener('message', this.handleMessage);
    }

    private handleMessage = async (e: MessageEvent): Promise<void> => {
        const msg = e.data;
        if (!msg || msg.type !== 'nest' || !msg.id || !msg.action) return;

        const source = e.source as WindowProxy | null;
        if (!source) return;

        try {
            const result = await this.dispatch(msg as NestMessage, source);
            const reply: NestReply = { type: 'nest-reply', id: msg.id, result };
            source.postMessage(reply, '*');
        } catch (err) {
            const reply: NestReply = { type: 'nest-reply', id: msg.id, error: String(err) };
            source.postMessage(reply, '*');
        }
    };

    private async dispatch(msg: NestMessage, _source: WindowProxy): Promise<unknown> {
        if (msg.type === 'nest-resize') return; // handled by ExtensionFrame directly

        switch (msg.action) {
            case 'fetch': {
                const res = await fetch(msg.args.url, {
                    ...msg.args.init,
                    credentials: 'include',
                });
                const contentType = res.headers.get('content-type') ?? '';
                const body = contentType.includes('json') ? await res.json() : await res.text();
                return { status: res.status, ok: res.ok, body };
            }
            case 'readFile': {
                const { root, path } = msg.args;
                const encoded = path.split('/').map(encodeURIComponent).join('/');
                const res = await fetch(`/api/files/${encodeURIComponent(root)}/${encoded}`, {
                    credentials: 'include',
                });
                if (!res.ok) throw new Error(`Failed to read file: ${res.status}`);
                return res.json();
            }
            case 'writeFile': {
                const { root, path, content } = msg.args;
                const encoded = path.split('/').map(encodeURIComponent).join('/');
                const res = await fetch(`/api/files/${encodeURIComponent(root)}/${encoded}`, {
                    method: 'PUT',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content }),
                });
                if (!res.ok) throw new Error(`Failed to write file: ${res.status}`);
                return res.json();
            }
            case 'state.get': {
                // State is scoped per extension via key prefix
                // Extensions in sandboxed iframes can't access localStorage directly
                const key = `nest-ext-state:${msg.args.key}`;
                const raw = localStorage.getItem(key);
                return raw ? JSON.parse(raw) : null;
            }
            case 'state.set': {
                const key = `nest-ext-state:${msg.args.key}`;
                localStorage.setItem(key, JSON.stringify(msg.args.value));
                return null;
            }
            default:
                throw new Error(`Unknown action: ${(msg as any).action}`);
        }
    }
}
