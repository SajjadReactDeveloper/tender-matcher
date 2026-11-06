import type { NextConfig } from 'next';
import { withWorkflow } from 'workflow/next';

const nextConfig: NextConfig = {
  // Authenticated, per-request app with a per-request CSP nonce: nothing here is worth prerendering.
  cacheComponents: false,
  // pdf.js and its native canvas module must stay outside the bundle (bundling them breaks the build).
  serverExternalPackages: ['pdf-to-img', 'pdfjs-dist', '@napi-rs/canvas'],
  // The company profile is read from disk by the fetch job, so make sure it ships with the job's routes.
  outputFileTracingIncludes: {
    '/.well-known/workflow/**': ['./config/profile.md'],
    '/api/**': ['./config/profile.md'],
  },
};

export default withWorkflow(nextConfig);
