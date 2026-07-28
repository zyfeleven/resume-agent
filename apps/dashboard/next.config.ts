import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The DOCX parser runs only in route handlers and must stay outside the client bundle.
  serverExternalPackages: ["mammoth", "playwright"],
};

export default nextConfig;
