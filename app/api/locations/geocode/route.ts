import { NextRequest, NextResponse } from 'next/server';
import { buildGeocodeQueries } from '@/lib/geocodeUtils';

type NominatimResult = {
  lat: string;
  lon: string;
};

async function geocodeQuery(query: string) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'br');
  url.searchParams.set('q', query);

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'pt-BR,pt;q=0.9',
      'User-Agent': 'MR-Entregas/1.0 (https://sistemas-pi.vercel.app)',
    },
  });

  if (!response.ok) return null;

  const data = await response.json() as NominatimResult[];
  const first = data[0];
  if (!first) return null;

  const latitude = Number(first.lat);
  const longitude = Number(first.lon);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return { latitude, longitude };
}

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get('address') ?? '';
  const queries = buildGeocodeQueries(address);

  for (const query of queries) {
    try {
      const coordinates = await geocodeQuery(query);
      if (coordinates) {
        return NextResponse.json({ coordinates, query });
      }
    } catch {
      // Try the next simplified query.
    }
  }

  return NextResponse.json({ coordinates: null });
}
