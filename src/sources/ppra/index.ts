import { fetchText } from '../http';
import type { TenderSource } from '../types';
import { PPRA_BASE, parseDetail, parseListing } from './parse';

export const ppra: TenderSource = {
  id: 'ppra',
  name: 'PPRA (EPADS)',
  listPage: async (page) => parseListing(await fetchText(`${PPRA_BASE}/public/tenders/active-tenders?page=${page}`), { allowEmpty: page > 1 }),
  getDetail: async (externalId) => parseDetail(await fetchText(`${PPRA_BASE}/public/tenders/tender-details/${encodeURIComponent(externalId)}`)),
  fileUrl: (path) => `${PPRA_BASE}${path}`,
};
