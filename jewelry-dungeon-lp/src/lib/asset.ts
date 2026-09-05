/**
 * public/ 配下のファイルパスに basePath を付ける。
 * GitHub Pages のプロジェクトサイト（https://<account>.github.io/<repo>/）のように
 * サブパス配下で配信する場合、next/image の src には basePath を自分で付ける必要がある。
 * ビルド時に NEXT_PUBLIC_BASE_PATH（例: "/jewelry-dungeon"）を指定すると反映される。
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function asset(path: string): string {
  return `${basePath}${path}`;
}

/** サイト内リンク用（asset と同じく basePath を付ける） */
export const withBasePath = asset;
