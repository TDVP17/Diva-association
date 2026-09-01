import { ImageResponse } from "next/og";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

export const alt = "DIVA Association — Automated tontine management";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const logoData = await readFile(join(process.cwd(), "public/icons/icon-512.png"), "base64");
const logoSrc = `data:image/png;base64,${logoData}`;

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#003528",
          gap: 28,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- next/og's ImageResponse renders via Satori, not the DOM; next/image doesn't apply here */}
        <img src={logoSrc} width={160} height={160} alt="" style={{ borderRadius: 32 }} />
        <div style={{ display: "flex", fontSize: 64, fontWeight: 700, color: "#ffffff", letterSpacing: -1 }}>
          DIVA Association
        </div>
        <div style={{ display: "flex", fontSize: 28, color: "#e9c349", fontWeight: 500 }}>
          Automated management for traditional tontines
        </div>
      </div>
    ),
    { ...size },
  );
}
