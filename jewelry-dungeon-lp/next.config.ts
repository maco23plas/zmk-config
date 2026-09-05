import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 静的LPとして `out/` に書き出す（GitHub Pages 等の静的ホスティング向け）
  output: "export",
  images: {
    // 静的書き出しでは画像最適化サーバーが無いため無効化
    unoptimized: true,
  },
};

export default nextConfig;
