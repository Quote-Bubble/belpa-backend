import { withSentryConfig } from "@sentry/nextjs";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'",
          },
        ],
      },
    ];
  },
};

// Source map upload only happens when SENTRY_AUTH_TOKEN is present, so local
// and CI builds are unaffected. Without maps, a stack trace from the minified
// bundle points at a column in a single line and is worth very little.
export default withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Strips the uploaded maps from the deployed output so the sources are
  // readable in Sentry but not served publicly.
  sourcemaps: { deleteSourcemapsAfterUpload: true },
});
