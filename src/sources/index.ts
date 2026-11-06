import { ppra } from './ppra';
import type { TenderSource } from './types';

// To add a source: implement TenderSource in its own folder and add it here.
export const sources: TenderSource[] = [ppra];

export const getSource = (id: string): TenderSource => {
  const s = sources.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown source "${id}"`);
  return s;
};
