export const MODEL: string;
export function embedText(text: string): Promise<number[]>;
export function lexicalEmbed(text: string, configuration: { vocabulary: string[]; idf: number[] }): number[];
export function normalize(vector: number[]): number[];
export function tokenize(text: string): string[];
export function embedQuery(text: string, indexModel: string, lexical: { vocabulary: string[]; idf: number[] }): Promise<{ vector: number[]; model: string; fallback: boolean; warning?: string }>;
