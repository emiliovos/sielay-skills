// Preloaded with `node --import` by mcp-headers.test.mjs: sends the helper's
// requests for the allow-listed origin to the fake hub on FAKE_HUB_PORT.
// Production code is untouched: the URL is rewritten here only.
const real = globalThis.fetch
const port = process.env.FAKE_HUB_PORT
globalThis.fetch = (url, init) => real(String(url).replace(/^https:\/\/sielay\.cloud/, `http://127.0.0.1:${port}`), init)
