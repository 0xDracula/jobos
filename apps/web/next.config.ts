import type { NextConfig } from "next";

const api = process.env.JOBBOS_API_URL ?? "http://127.0.0.1:8080";

const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  images: { unoptimized: true },
  ...(process.env.NODE_ENV === "development"
    ? { rewrites: async () => [{ source: "/api/:path*", destination: `${api}/api/:path*` }] }
    : {}),
};

export default config;
