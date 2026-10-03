// All provider hosts are fixed by adapters. Never fetch a customer-supplied URL.
export class IntegrationError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}
export async function providerJSON(fetcher, url, options = {}) {
  let response;
  try {
    response = await fetcher(url, {...options, redirect:'error', signal:AbortSignal.timeout(15000)});
    const reader = response.body?.getReader();
    let text = '';
    if (reader) {
      const chunks = []; let size = 0;
      while (true) {
        const {value, done} = await reader.read(); if (done) break;
        size += value.length;
        if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('Response too large'); }
        chunks.push(Buffer.from(value));
      }
      text = Buffer.concat(chunks).toString('utf8');
    } else text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) throw new IntegrationError(`Provider request failed (HTTP ${response.status}). Check provider access and configuration.`);
    return data;
  } catch (error) {
    if (error instanceof IntegrationError) throw error;
    throw new IntegrationError('Provider response could not be verified. Try again later.');
  }
}
export const enabled = value => String(value).toLowerCase() === 'true';
