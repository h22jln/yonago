import { list, get, put, del } from '@vercel/blob';

const tripPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pinPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const tripFrom = request => {
  const trip = request.headers.get('x-trip-key') || '';
  return tripPattern.test(trip) ? trip.toLowerCase() : null;
};
const prefixFor = trip => `trips/${trip}/pins/`;

async function pinFiles(trip) {
  const result = await list({ prefix: prefixFor(trip), limit: 101 });
  return result.blobs;
}

export async function GET(request) {
  const trip = tripFrom(request);
  if (!trip) return reply({ error: '공유 링크가 올바르지 않습니다.' }, 400);
  if (!process.env.BLOB_READ_WRITE_TOKEN) return reply({ error: '핀 저장소가 연결되지 않았습니다.' }, 503);
  try {
    const blobs = await pinFiles(trip);
    const pins = await Promise.all(blobs.map(async blob => {
      const item = await get(blob.pathname, { access: 'private' });
      if (!item?.stream) return null;
      const pin = await new Response(item.stream).json();
      return pin;
    }));
    return reply({ pins: pins.filter(Boolean).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) });
  } catch (error) {
    console.error('pin read failed', error);
    return reply({ error: '핀을 불러오지 못했습니다.' }, 500);
  }
}

export async function POST(request) {
  const trip = tripFrom(request);
  if (!trip) return reply({ error: '공유 링크가 올바르지 않습니다.' }, 400);
  if (!process.env.BLOB_READ_WRITE_TOKEN) return reply({ error: '핀 저장소가 연결되지 않았습니다.' }, 503);
  try {
    const raw = await request.text();
    if (raw.length > 2048) return reply({ error: '입력 내용이 너무 깁니다.' }, 413);
    const body = JSON.parse(raw);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const day = Number(body.day);
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!name || name.length > 60 || !Number.isInteger(day) || day < 0 || day > 4 || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return reply({ error: '핀 정보가 올바르지 않습니다.' }, 400);
    }
    if ((await pinFiles(trip)).length >= 100) return reply({ error: '핀은 최대 100개까지 저장할 수 있습니다.' }, 409);
    const pin = { id: crypto.randomUUID(), name, day, lat, lng, createdAt: new Date().toISOString() };
    await put(`${prefixFor(trip)}${pin.id}.json`, JSON.stringify(pin), { access: 'private', contentType: 'application/json', addRandomSuffix: false });
    return reply({ pin }, 201);
  } catch (error) {
    console.error('pin save failed', error);
    return reply({ error: '핀을 저장하지 못했습니다.' }, 500);
  }
}

export async function DELETE(request) {
  const trip = tripFrom(request);
  if (!trip) return reply({ error: '공유 링크가 올바르지 않습니다.' }, 400);
  if (!process.env.BLOB_READ_WRITE_TOKEN) return reply({ error: '핀 저장소가 연결되지 않았습니다.' }, 503);
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!pinPattern.test(id)) return reply({ error: '핀 번호가 올바르지 않습니다.' }, 400);
  try {
    await del(`${prefixFor(trip)}${id}.json`);
    return reply({ ok: true });
  } catch (error) {
    console.error('pin delete failed', error);
    return reply({ error: '핀을 삭제하지 못했습니다.' }, 500);
  }
}
