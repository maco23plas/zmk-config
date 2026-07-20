// electron-builder の署名フェーズ後に、アプリへ確実にアドホック署名を焼き込む。
// これをしないと Apple Silicon が無署名アプリを「壊れている」と拒否する。
const path = require('path');
const { execSync } = require('child_process');

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  // 入れ子のバイナリ (ffmpeg 等) も含めてアドホック署名する (失敗したらビルドを止める)
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
  console.log(`[after-sign] ad-hoc signed: ${appPath}`);
  // 検証は参考情報 (失敗してもビルドは止めない)
  try {
    execSync(`codesign --verify --deep --strict "${appPath}"`, { stdio: 'inherit' });
    console.log('[after-sign] signature verified');
  } catch (e) {
    console.warn('[after-sign] verify warning:', e.message);
  }
};
