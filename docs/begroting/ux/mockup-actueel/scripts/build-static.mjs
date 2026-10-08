import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/client', { recursive: true });
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await cp('index.html', 'dist/client/index.html');
await cp('src', 'dist/client/src', { recursive: true });
await cp('public', 'dist/client', { recursive: true });
await cp('worker/index.js', 'dist/server/index.js');
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
process.stdout.write('Static prototype built in dist/client\n');
