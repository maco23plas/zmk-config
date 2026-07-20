# アプリのアイコン置き場

ここに **`icon.png`（1024×1024 推奨・正方形の PNG）** を置くと、次のビルドから
Mac(.dmg) / Windows(.exe) のアプリアイコンに自動で使われます（electron-builder が
`.icns` / `.ico` に変換します）。

ロゴ `rogo_MinuteMate.png` をこのフォルダに `icon.png` という名前でコピーしてください:

```
minutemate/build/icon.png
```

置いてコミットしたら、新しいバージョンタグ（例 `v0.1.1`）を打てば、その回から反映されます。
