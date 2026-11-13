// A patch packed into a link: <app>#p=<deflated json, base64url>. Nothing is
// stored on the server; whoever opens the link gets the patch.

const PREFIX = '#p=';

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function patchToHash(patch) {
  const packed = await pipe(new TextEncoder().encode(JSON.stringify(patch)), new CompressionStream('deflate-raw'));
  let binary = '';
  for (const b of packed) binary += String.fromCharCode(b);
  return PREFIX + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// the patch in a location hash, or null if there is none
export async function patchFromHash(hash) {
  if (!hash.startsWith(PREFIX)) return null;
  const binary = atob(hash.slice(PREFIX.length).replace(/-/g, '+').replace(/_/g, '/'));
  const packed = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const bytes = await pipe(packed, new DecompressionStream('deflate-raw'));
  return JSON.parse(new TextDecoder().decode(bytes));
}
