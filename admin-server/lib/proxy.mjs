import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

/** Minimal reverse proxy middleware — forwards anything not handled by an
 * earlier route to another origin (the public site). Deliberately hand-
 * rolled instead of pulling in http-proxy-middleware, whose dependency
 * chain (micromatch/braces) currently carries known vulnerabilities. */
export function proxyTo(targetOrigin) {
  const target = new URL(targetOrigin);
  const isHttps = target.protocol === 'https:';
  const doRequest = isHttps ? httpsRequest : httpRequest;
  // targetOrigin may itself include a path prefix (e.g. GitHub Pages'
  // "/alexportfolio" project base path) — carry that prefix on every
  // forwarded request rather than just the bare origin.
  const basePath = target.pathname.replace(/\/$/, '');

  return (clientReq, clientRes) => {
    const proxyReq = doRequest(
      {
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: basePath + clientReq.url,
        method: clientReq.method,
        headers: { ...clientReq.headers, host: target.host },
      },
      (proxyRes) => {
        clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(clientRes);
      },
    );
    proxyReq.on('error', (err) => {
      clientRes.writeHead(502);
      clientRes.end(`Upstream (${targetOrigin}) error: ${err.message}`);
    });
    clientReq.pipe(proxyReq);
  };
}
