#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/Users/soul/Source/connect_dise/games/dixit';
const PROMPT_FILE = path.join(ROOT, 'cards', 'IMAGE_PROMPTS_200.md');
const OUT_DIR = path.join(ROOT, 'assets', 'cards');

const MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
const SIZE = process.env.OPENAI_IMAGE_SIZE || '1024x1536';
const MAX_PER_RUN = Number(process.env.MAX_PER_RUN || '10');
const MARK_DONE = process.env.MARK_DONE === '1';

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error('OPENAI_API_KEY is not set.');
  process.exit(1);
}

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const md = fs.readFileSync(PROMPT_FILE, 'utf8');
const lines = md.split('\n');

const items = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  const m = line.match(/^(\d{3})\.\s+(.*)$/);
  if (!m) continue;
  const num = m[1];
  const sceneRaw = m[2].trim();
  const done = /\(DONE\)\s*$/i.test(sceneRaw);
  const scene = sceneRaw.replace(/\s*\(DONE\)\s*$/i, '').replace(/\.$/, '').trim();
  const filename = `card_${num}.png`;
  const filepath = path.join(OUT_DIR, filename);
  const exists = fs.existsSync(filepath);
  items.push({ i, num, scene, done, filename, filepath, exists });
}

const pending = items.filter(x => !x.done && !x.exists);
if (pending.length === 0) {
  console.log('No pending prompts to generate.');
  process.exit(0);
}

const selected = pending.slice(0, MAX_PER_RUN);
console.log(`Generating ${selected.length} images with ${MODEL} (${SIZE})`);

async function generateOne(item) {
  const prompt = `Dreamy storybook illustration, whimsical surrealism, soft painterly texture, rich but gentle colors, clean silhouette, centered composition, 3:4 vertical card art, no text, no watermark, no logo, no frame, no border. Scene: ${item.scene}.`;

  const resp = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      size: SIZE,
      output_format: 'png',
    }),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`${resp.status} ${resp.statusText}: ${t}`);
  }

  const json = await resp.json();
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error('No b64_json in response');

  fs.writeFileSync(item.filepath, Buffer.from(b64, 'base64'));
  console.log(`Saved ${item.filename}`);

  if (MARK_DONE) {
    const original = lines[item.i];
    if (!/\(DONE\)/i.test(original)) lines[item.i] = `${original} (DONE)`;
  }
}

for (const item of selected) {
  try {
    await generateOne(item);
  } catch (err) {
    console.error(`Failed ${item.filename}: ${err.message}`);
    break;
  }
}

if (MARK_DONE) {
  fs.writeFileSync(PROMPT_FILE, lines.join('\n'), 'utf8');
  console.log('Updated DONE marks in IMAGE_PROMPTS_200.md');
}

console.log('Done.');
