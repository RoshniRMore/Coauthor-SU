import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const MODEL = 'Xenova/all-MiniLM-L6-v2';
const cacheRoot = path.resolve('data/cache/neural-v1');
let extractor;
let queue = Promise.resolve();
export const normalize = vector => {
  const norm = Math.hypot(...vector) || 1;
  return vector.map(value => value / norm);
};
export const tokenize = text => text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu) || [];
export function lexicalEmbed(text, { vocabulary, idf }) {
  const counts = new Map();
  for (const word of tokenize(text)) counts.set(word, (counts.get(word) || 0) + 1);
  return normalize(vocabulary.map((word, i) => counts.has(word) ? (1 + Math.log(counts.get(word))) * idf[i] : 0));
}
async function compute(text) {
  const hash = createHash('sha256').update(JSON.stringify([MODEL, 'q8-mean-180-word-chunks-v1', text])).digest('hex');
  const file = path.join(cacheRoot, `${hash}.json`);
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!extractor) {
    extractor = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.cacheDir = path.resolve('data/cache/models');
      return pipeline('feature-extraction', MODEL, { dtype: 'q8', device: 'cpu', session_options: { intraOpNumThreads: 4 } });
    })();
    extractor.catch(() => { extractor = undefined; });
  }
  const model = await extractor;
  // Chunk long composites so every publication contributes, not only the prefix.
  const words = text.split(/\s+/);
  const sum = Array(384).fill(0);
  for (let start = 0; start < words.length; start += 180) {
    const chunk = words.slice(start, start + 180);
    const output = await model(chunk.join(' '), { pooling: 'mean', normalize: true });
    output.tolist()[0].forEach((value, i) => { sum[i] += value * chunk.length; });
  }
  const vector = normalize(sum);
  await fs.mkdir(cacheRoot, { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(vector));
  await fs.rename(temporary, file);
  return vector;
}
export function embedText(text) {
  const result = queue.then(() => compute(text));
  queue = result.catch(() => {});
  return result;
}

export async function embedQuery(text, indexModel, lexical) {
  try {
    if (indexModel !== MODEL) throw new Error('Index uses the TF-IDF fallback; rebuild with npm run index.');
    return { vector: await embedText(text), model: MODEL, fallback: false };
  } catch (error) {
    const warning = 'WARNING: NEURAL EMBEDDINGS UNAVAILABLE. Matching uses TF-IDF fallback.';
    console.error(warning, error.message);
    return { vector: lexicalEmbed(text, lexical), model: 'tf-idf-384', fallback: true, warning };
  }
}
