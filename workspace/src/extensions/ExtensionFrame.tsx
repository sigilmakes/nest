import { useRef, useEffect, useState } from 'react';
import type { NestTheme } from './types';

interface ExtensionFrameProps {
    extensionId: string;
    entry: string;  // relative path to entry JS (e.g. 'panel.js')
    defaultHeight?: number;
    className?: string;
}

export default function ExtensionFrame({ extensionId, entry, defaultHeight = 150, className }: ExtensionFrameProps) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [height, setHeight] = useState(defaultHeight);

    // Build srcdoc with SDK + extension entry
    const srcdoc = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>body { margin: 0; font-family: system-ui, sans-serif; }</style>
</head>
<body>
    <script type="module">
        import '/nest-sdk.js';
        import '/api/extensions/${extensionId}/${entry}';
    </script>
</body>
</html>`;

    // Listen for resize messages from this iframe
    useEffect(() => {
        const handler = (e: MessageEvent) => {
            if (e.source !== iframeRef.current?.contentWindow) return;
            if (e.data?.type === 'nest-resize' && typeof e.data.height === 'number') {
                setHeight(e.data.height);
            }
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, []);

    // Post theme vars on mount
    useEffect(() => {
        const iframe = iframeRef.current;
        if (!iframe) return;
        const onLoad = () => {
            const styles = getComputedStyle(document.documentElement);
            const vars: Record<string, string> = {};
            // Extract CSS custom properties
            for (const prop of ['--bg-primary', '--bg-secondary', '--bg-tertiary',
                '--text-primary', '--text-secondary', '--accent', '--accent-hover',
                '--border', '--error', '--success']) {
                vars[prop] = styles.getPropertyValue(prop).trim();
            }
            iframe.contentWindow?.postMessage({ type: 'nest-theme', vars } satisfies NestTheme, '*');
        };
        iframe.addEventListener('load', onLoad);
        return () => iframe.removeEventListener('load', onLoad);
    }, []);

    return (
        <iframe
            ref={iframeRef}
            sandbox="allow-scripts"
            srcDoc={srcdoc}
            className={`extension-frame ${className ?? ''}`}
            style={{ width: '100%', height: `${height}px`, border: 'none' }}
            title={`Extension: ${extensionId}`}
        />
    );
}
