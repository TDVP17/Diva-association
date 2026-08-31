import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  suburb?: string;
  neighbourhood?: string;
  quarter?: string;
}

/**
 * Turns GPS coordinates from the browser's Geolocation API into a
 * best-effort city/neighborhood guess, using OpenStreetMap's free Nominatim
 * service (no API key, no per-request cost — same budget constraint that
 * ruled out a paid geocoding provider). Proxied server-side so we can set
 * the User-Agent Nominatim's usage policy requires, and so the browser
 * doesn't need direct cross-origin access to it.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({ lat: searchParams.get("lat"), lng: searchParams.get("lng") });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${parsed.data.lat}&lon=${parsed.data.lng}&zoom=14&addressdetails=1`,
      { headers: { "User-Agent": "DIVA-Association-App/1.0 (contact via app support)" } },
    );
    if (!res.ok) {
      return NextResponse.json({ error: "Could not resolve this location" }, { status: 502 });
    }
    const body = (await res.json()) as { address?: NominatimAddress };
    const address = body.address ?? {};
    const city = address.city ?? address.town ?? address.village ?? address.municipality ?? null;
    const neighborhood = address.suburb ?? address.neighbourhood ?? address.quarter ?? null;

    return NextResponse.json({ city, neighborhood });
  } catch (err) {
    console.error("[profile/reverse-geocode] unexpected error:", err);
    return NextResponse.json({ error: "Could not resolve this location" }, { status: 500 });
  }
}
