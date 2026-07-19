/**
 * デスクトップアプリ用の軽量エントリ。
 * Electron のメインプロセスから起動され、Web ダッシュボードだけを立てる
 * （録音アップロード→議事録の用途に特化。カレンダー監視・自動入室ボットは含めない）。
 */
import { ensureDirs } from './config.js';
import { startWeb } from './web.js';

ensureDirs();
startWeb();
