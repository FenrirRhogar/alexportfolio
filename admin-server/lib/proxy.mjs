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

  // The built site's own links already include the base path (Astro bakes
  // "/alexportfolio/..." into every href), so only add the prefix when the
  // request doesn't carry it yet — otherwise it'd be doubled upstream.
  const upstreamPath = (url) =>
    !basePath || url === basePath || url.startsWith(basePath + '/') || url.startsWith(basePath + '?')
      ? url
      : basePath + url;

  // Upstream redirects (e.g. GitHub Pages' trailing-slash 301s) point at the
  // upstream's own absolute URL — make them root-relative so the visitor
  // stays on this server's domain instead of being bounced to the origin.
  const rewriteLocation = (location) => {
    try {
      const loc = new URL(location, target);
      return loc.host === target.host ? loc.pathname + loc.search + loc.hash : location;
    } catch {
      return location;
    }
  };

  return (clientReq, clientRes) => {
    const proxyReq = doRequest(
      {
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: upstreamPath(clientReq.url),
        method: clientReq.method,
        headers: { ...clientReq.headers, host: target.host },
      },
      (proxyRes) => {
        const headers = { ...proxyRes.headers };
        if (headers.location) headers.location = rewriteLocation(headers.location);
        clientRes.writeHead(proxyRes.statusCode, headers);
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
