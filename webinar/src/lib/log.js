const stamp = () => new Date().toISOString();
const out = (level, args) => console[level === 'error' ? 'error' : 'log'](`[${stamp()}] [${level}]`, ...args);

export const log = {
  info: (...a) => out('info', a),
  warn: (...a) => out('warn', a),
  error: (...a) => out('error', a),
};
