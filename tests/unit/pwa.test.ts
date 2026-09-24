import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const publicDir = path.resolve('public');
const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, 'manifest.json'), 'utf8'));
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.start_url, '/app');
assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);

for (const size of [192, 512]) {
  const icon = manifest.icons.find((entry: { sizes: string }) => entry.sizes === `${size}x${size}`);
  assert.ok(icon, `ícone ${size}px ausente do manifest`);
  const data = fs.readFileSync(path.join(publicDir, icon.src.replace(/^\//, '')));
  assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'ícone deve ser PNG');
  assert.equal(data.readUInt32BE(16), size);
  assert.equal(data.readUInt32BE(20), size);
}

const worker = fs.readFileSync(path.join(publicDir, 'sw.js'), 'utf8');
assert.match(worker, /PUBLIC_ASSETS/);
assert.doesNotMatch(worker, /cache\.put\(.*\/api\//);
assert.match(fs.readFileSync(path.join(publicDir, 'offline.html'), 'utf8'), /Nenhuma venda ou pagamento foi salvo/);
console.log('PWA: manifest, instalação, ícones e cache público validados.');
