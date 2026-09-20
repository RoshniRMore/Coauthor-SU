export default {
  outputFileTracingRoot: process.cwd(),
  experimental: { cpus: 2 },
  serverExternalPackages: ['@huggingface/transformers', 'onnxruntime-node'],
};
