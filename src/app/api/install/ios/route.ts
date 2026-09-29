import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // Resolve host and protocol dynamically from incoming request
    const proto = req.headers.get("x-forwarded-proto") || "https";
    const host = req.headers.get("host") || "diva-association.vercel.app";
    const targetUrl = `${proto}://${host}/dashboard`;

    // Read icon-192.png and convert to base64 for embedding in the Apple WebClip profile
    let iconBase64 = "";
    try {
      const iconPath = path.join(process.cwd(), "public", "icons", "icon-192.png");
      if (fs.existsSync(iconPath)) {
        iconBase64 = fs.readFileSync(iconPath).toString("base64");
      }
    } catch (iconErr) {
      console.warn("[iOS MobileConfig] Failed to load icon file:", iconErr);
    }

    const iconSnippet = iconBase64
      ? `<key>Icon</key>
            <data>
${iconBase64}
            </data>`
      : "";

    // Generate valid Apple Configuration Profile (.mobileconfig) for automatic iOS WebClip install
    const mobileconfig = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>PayloadContent</key>
    <array>
        <dict>
            <key>FullScreen</key>
            <true/>
            ${iconSnippet}
            <key>IsRemovable</key>
            <true/>
            <key>Label</key>
            <string>Diva Association</string>
            <key>PayloadDescription</key>
            <string>Application mobile Diva Association</string>
            <key>PayloadDisplayName</key>
            <string>Diva Association</string>
            <key>PayloadIdentifier</key>
            <string>com.divaassociation.app.webclip</string>
            <key>PayloadType</key>
            <string>com.apple.webClip.managed</string>
            <key>PayloadUUID</key>
            <string>9B52445E-0994-4638-9B9D-82DE6A6498F4</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
            <key>Precomposed</key>
            <true/>
            <key>URL</key>
            <string>${targetUrl}</string>
        </dict>
    </array>
    <key>PayloadDisplayName</key>
    <string>Diva Association</string>
    <key>PayloadIdentifier</key>
    <string>com.divaassociation.app</string>
    <key>PayloadOrganization</key>
    <string>Diva Association</string>
    <key>PayloadRemovalDisallowed</key>
    <false/>
    <key>PayloadType</key>
    <string>Configuration</string>
    <key>PayloadUUID</key>
    <string>6E84FF36-A785-4D56-9DC7-975D1B8E85A2</string>
    <key>PayloadVersion</key>
    <integer>1</integer>
</dict>
</plist>`;

    return new NextResponse(mobileconfig, {
      status: 200,
      headers: {
        "Content-Type": "application/x-apple-aspen-config; charset=utf-8",
        "Content-Disposition": 'attachment; filename="diva-association.mobileconfig"',
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    console.error("[iOS MobileConfig] Generation error:", error);
    return new NextResponse("Failed to generate iOS configuration profile", { status: 500 });
  }
}
