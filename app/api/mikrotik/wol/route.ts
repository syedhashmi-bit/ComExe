import { NextResponse } from "next/server";
import { loadConfig } from "@/app/lib/server-config";
import dgram from "node:dgram";

// ── /api/mikrotik/wol ────────────────────────────────────────────────────────
// Wake-on-LAN. Two paths:
//   1. POST to MikroTik's /tool/wol — works when the dashboard can reach the
//      router but the target device is on a subnet only the router can reach.
//   2. Send the magic packet ourselves to 255.255.255.255:9 — works when
//      ComExe runs on the same broadcast domain as the target (we do, via
//      `--network host` on TrueNAS).
//
// Try MikroTik first since it's more capable; fall back to direct broadcast
// if RouterOS rejects (older versions, missing capability, etc).

interface WolBody { mac: string; interface?: string }

function isValidMac(mac: string): boolean {
  return /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(mac);
}

// Build the magic packet: 6 × 0xFF + 16 × MAC bytes = 102 bytes.
function buildMagicPacket(mac: string): Buffer {
  const bytes = mac.split(/[:-]/).map(b => parseInt(b, 16));
  const buf = Buffer.alloc(102);
  buf.fill(0xff, 0, 6);
  for (let i = 0; i < 16; i++) Buffer.from(bytes).copy(buf, 6 + i * 6);
  return buf;
}

function sendBroadcast(mac: string): Promise<{ ok: boolean; message: string }> {
  return new Promise(resolve => {
    const packet = buildMagicPacket(mac);
    const sock = dgram.createSocket("udp4");
    sock.bind(0, () => {
      try { sock.setBroadcast(true); } catch { /* not allowed in some envs */ }
      sock.send(packet, 0, packet.length, 9, "255.255.255.255", err => {
        sock.close();
        if (err) resolve({ ok: false, message: `Broadcast failed: ${err.message}` });
        else     resolve({ ok: true,  message: "Magic packet sent via local broadcast" });
      });
    });
    sock.on("error", err => {
      try { sock.close(); } catch {}
      resolve({ ok: false, message: `Socket error: ${err.message}` });
    });
  });
}

async function sendViaMikrotik(mac: string, iface?: string): Promise<{ ok: boolean; message: string }> {
  const cfg = await loadConfig();
  if (!cfg.mikrotik.configured) {
    return { ok: false, message: "MikroTik credentials not set" };
  }
  try {
    const auth = Buffer.from(`${cfg.mikrotik.username}:${cfg.mikrotik.password}`, "utf8").toString("base64");
    const body: Record<string, string> = { mac };
    if (iface) body.interface = iface;
    const res = await fetch(`${cfg.mikrotik.url}/rest/tool/wol`, {
      method:  "POST",
      headers: { Authorization: "Basic " + auth, "Content-Type": "application/json", Accept: "application/json" },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, message: `MikroTik returned ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}` };
    }
    return { ok: true, message: `Magic packet sent via MikroTik${iface ? ` on ${iface}` : ""}` };
  } catch (e) {
    return { ok: false, message: `MikroTik request failed: ${(e as Error).message}` };
  }
}

export async function POST(req: Request) {
  let body: WolBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, message: "Invalid JSON" }, { status: 400 }); }

  const mac = typeof body.mac === "string" ? body.mac.trim() : "";
  if (!isValidMac(mac)) {
    return NextResponse.json({ ok: false, message: "Invalid MAC address" }, { status: 400 });
  }
  const iface = typeof body.interface === "string" ? body.interface.trim() : undefined;

  // Try MikroTik first
  const viaRouter = await sendViaMikrotik(mac, iface);
  if (viaRouter.ok) return NextResponse.json(viaRouter);

  // Fall back to local broadcast
  const viaBroadcast = await sendBroadcast(mac);
  return NextResponse.json({
    ...viaBroadcast,
    routerAttempt: viaRouter.message,
  });
}
