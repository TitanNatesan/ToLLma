/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export for GitHub Pages: `next build` emits plain HTML/CSS/JS
  // into `landing/out/`. No server runtime, no API routes, no auth.
  output: "export",
  trailingSlash: true,
  images: {
    // next/image optimization requires a server; disabled for static export.
    unoptimized: true,
  },
  // Set BASE_PATH=/<repo-name> at build time for a project Pages site,
  // e.g. BASE_PATH=/tollma. Leave empty for a user/org site or custom domain.
  basePath: process.env.BASE_PATH || "",
};

export default nextConfig;
