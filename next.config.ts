import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/assessment-follow-up",
  assetPrefix: "/assessment-follow-up/",
  trailingSlash: true,
};

export default nextConfig;
