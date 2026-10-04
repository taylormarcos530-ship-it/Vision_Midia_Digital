import originalHandler from '../../api/news-feed.js';

// Preserve the existing feed allowlist/parser and adapt only the hosting API.
export default async function newsFeed(request: Request) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
  let status = 200;
  let payload: unknown;
  const response = {
    setHeader(name: string, value: string) { headers.set(name, value); },
    status(code: number) { status = code; return response; },
    json(value: unknown) { payload = value; },
  };
  await originalHandler({ query: { source: new URL(request.url).searchParams.get('source') || 'soccer' } }, response);
  return new Response(JSON.stringify(payload), { status, headers });
}

export const config = { path: '/api/news-feed', method: 'GET' };
