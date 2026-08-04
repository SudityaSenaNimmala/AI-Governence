// Real-time SIEM forwarder — pushes governance records to a syslog collector as
// they happen, so a SIEM doesn't have to poll the pull endpoint.
//
// Off unless configured. Enable via env:
//   SIEM_SYSLOG_HOST   collector host/IP        (required to enable)
//   SIEM_SYSLOG_PORT   default 514
//   SIEM_SYSLOG_PROTO  udp | tcp   (default udp)
//   SIEM_FORMAT        cef | leef  (default cef)
//
// Fire-and-forget: never throws into the caller's request path.

import dgram from 'node:dgram';
import net from 'node:net';
import {
  normalizeDlpEvent, normalizeApproval, normalizeViolation, normalizeAlert,
  render, toSyslog,
} from './cef.js';

const HOST = process.env.SIEM_SYSLOG_HOST || null;
const PORT = Number(process.env.SIEM_SYSLOG_PORT) || 514;
const PROTO = (process.env.SIEM_SYSLOG_PROTO || 'udp').toLowerCase();
const FORMAT = (process.env.SIEM_FORMAT || 'cef').toLowerCase() === 'leef' ? 'leef' : 'cef';

const NORMALIZERS = {
  dlp: normalizeDlpEvent,
  approval: normalizeApproval,
  violation: normalizeViolation,
  alert: normalizeAlert,
};

export function siemEnabled() { return !!HOST; }

let udpSock = null;
function udp() {
  if (!udpSock) {
    udpSock = dgram.createSocket('udp4');
    udpSock.on('error', () => {}); // swallow — audit forwarding must never crash us
    udpSock.unref();               // don't keep the process alive for this
  }
  return udpSock;
}

export function siemForward(type, record) {
  if (!HOST) return;
  try {
    const norm = NORMALIZERS[type];
    if (!norm) return;
    const ev = norm(record);
    const frame = toSyslog(render(ev, FORMAT), ev);
    if (PROTO === 'tcp') {
      const sock = net.connect(PORT, HOST, () => { sock.write(frame + '\n'); sock.end(); });
      sock.on('error', () => {});
      sock.setTimeout(5000, () => sock.destroy());
      sock.unref();
    } else {
      const buf = Buffer.from(frame);
      udp().send(buf, 0, buf.length, PORT, HOST, () => {});
    }
  } catch { /* never break the caller */ }
}
