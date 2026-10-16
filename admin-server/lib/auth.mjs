import { BlockList, isIP } from 'node:net';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// Cloudflare's published edge ranges (https://www.cloudflare.com/ips/).
// Requests arrive Cloudflare → Nginx Proxy Manager → here, so the address
// NPM hands us (X-Real-IP) is normally a Cloudflare server, with the real
// visitor in CF-Connecting-IP. That header is only believed when the
// request really did come from Cloudflare — anyone connecting to the
// server directly could otherwise put any address they like in it.
const CLOUDFLARE = new BlockList();
for (const range of [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18',
  '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17',
  '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
]) {
  const [net, bits] = range.split('/');
  CLOUDFLARE.addSubnet(net, Number(bits), 'ipv4');
}
for (const range of [
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
]) {
  const [net, bits] = range.split('/');
  CLOUDFLARE.addSubnet(net, Number(bits), 'ipv6');
}

const bare = (ip) => String(ip || '').trim().replace(/^::ffff:(?=\d+\.)/, '');

/** The real visitor's address — see the note above for who's trusted. The
 * app isn't published on any host port, so every request comes through
 * NPM, which always overwrites X-Real-IP with the address it saw. */
export function clientIp(req) {
  const peer = bare(req.get('x-real-ip')) || bare(req.socket.remoteAddress);
  const family = isIP(peer);
  if (family && CLOUDFLARE.check(peer, family === 4 ? 'ipv4' : 'ipv6')) {
    const visitor = bare(req.get('cf-connecting-ip'));
    if (isIP(visitor)) return visitor;
  }
  return peer;
}

// Only failed logins count toward these (a failed attempt answers 401, a
// successful one redirects), so Alexandra logging in normally never uses
// any of them up.
const failedOnly = { skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false };

/** One address: 5 wrong passwords, then locked out for 15 minutes. */
export const loginLimiterPerIp = rateLimit({
  ...failedOnly,
  windowMs: 15 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => ipKeyGenerator(clientIp(req)),
  handler: (req, res) =>
    res.status(429).render('login', { error: 'Too many wrong passwords. Wait 15 minutes and try again.' }),
});

/** Everyone together: guessing spread across many addresses is capped too —
 * at most 50 wrong passwords an hour across the whole internet. */
export const loginLimiterGlobal = rateLimit({
  ...failedOnly,
  windowMs: 60 * 60 * 1000,
  limit: 50,
  keyGenerator: () => 'all-visitors',
  handler: (req, res) =>
    res.status(429).render('login', { error: 'Logging in is paused for a while after too many wrong passwords. Try again later.' }),
});
