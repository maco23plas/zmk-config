import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 静的LPとして `out/` に書き出す（GitHub Pages 等の静的ホスティング向け）
  output: "export",
  // サブパス配下で配信する場合はビルド時に NEXT_PUBLIC_BASE_PATH を指定する（例: "/jewelry-dungeon"）
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  images: {
    // 静的書き出しでは画像最適化サーバーが無いため無効化
    unoptimized: true,
  },
};

export default nextConfig;
