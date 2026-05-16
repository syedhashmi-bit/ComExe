import { NextResponse } from "next/server";
import { isDockerEnabled } from "@/app/lib/docker";
import http from "node:http";

const DOCKER_SOCK = process.env.DOCKER_SOCK ?? "/var/run/docker.sock";

export const dynamic = "force-dynamic";

interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  created: number;
}

function dockerRequest(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: DOCKER_SOCK, method: "GET", path, headers: { Accept: "application/json" }, timeout: 10_000 },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString()));
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}

export async function GET() {
  if (!isDockerEnabled()) {
    return NextResponse.json({ ok: false, containers: [], message: "Docker control disabled" }, { status: 403 });
  }

  try {
    const raw = await dockerRequest("/containers/json?all=true");
    const list: Record<string, unknown>[] = JSON.parse(raw);

    const containers: ContainerInfo[] = list.map((c) => {
      const names = (c.Names as string[]) ?? [];
      const name = names[0]?.replace(/^\//, "") ?? "unknown";
      return {
        id: (c.Id as string)?.slice(0, 12) ?? "",
        name,
        image: (c.Image as string) ?? "",
        state: (c.State as string) ?? "",
        status: (c.Status as string) ?? "",
        created: (c.Created as number) ?? 0,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ ok: true, containers });
  } catch (e) {
    return NextResponse.json({ ok: false, containers: [], message: (e as Error).message }, { status: 502 });
  }
}
