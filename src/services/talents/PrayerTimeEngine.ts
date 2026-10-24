import type {
  TalentEngine,
  TalentResult,
  ToolDefinition,
  TalentExecuteContext,
} from './types';

/**
 * Approximate prayer times (offline) using a simple solar formula.
 * Not a certified religious authority — labels output as approximate.
 * Default location: Tarakan, Kalimantan Utara when lat/lon omitted.
 */
function deg2rad(d: number) {
  return (d * Math.PI) / 180;
}
function rad2deg(r: number) {
  return (r * 180) / Math.PI;
}

function prayerTimes(
  lat: number,
  lon: number,
  date: Date,
): Record<string, string> {
  // Very simplified approximation for UX; replace with adhan lib later.
  const day =
    Math.floor(
      (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
        Date.UTC(date.getFullYear(), 0, 0)) /
        86400000,
    );
  const decl =
    23.45 * Math.sin(deg2rad((360 / 365) * (day - 81)));
  const latR = deg2rad(lat);
  const declR = deg2rad(decl);
  const cosHa = -Math.tan(latR) * Math.tan(declR);
  const ha =
    cosHa >= 1 ? 0 : cosHa <= -1 ? 12 : rad2deg(Math.acos(cosHa)) / 15;
  const noon = 12 - lon / 15;
  const fmt = (h: number) => {
    let hh = Math.floor(h);
    let mm = Math.round((h - hh) * 60);
    if (mm === 60) {
      hh += 1;
      mm = 0;
    }
    hh = ((hh % 24) + 24) % 24;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };
  return {
    Subuh: fmt(noon - ha - 0.3),
    Dzuhur: fmt(noon),
    Ashar: fmt(noon + ha * 0.5),
    Maghrib: fmt(noon + ha),
    Isya: fmt(noon + ha + 0.6),
  };
}

export class PrayerTimeEngine implements TalentEngine {
  readonly name = 'prayer_times';

  async execute(
    args: Record<string, any>,
    _ctx?: TalentExecuteContext,
  ): Promise<TalentResult> {
    const lat =
      typeof args.latitude === 'number' ? args.latitude : 3.3; // Tarakan-ish
    const lon =
      typeof args.longitude === 'number' ? args.longitude : 117.6;
    const city =
      typeof args.city === 'string' && args.city.trim()
        ? args.city.trim()
        : 'Tarakan (default)';
    const times = prayerTimes(lat, lon, new Date());
    const lines = Object.entries(times).map(([k, v]) => `${k}: ${v}`);
    return {
      type: 'text',
      summary: [
        `Jadwal sholat perkiraan — ${city}`,
        `(lat ${lat.toFixed(2)}, lon ${lon.toFixed(2)}; offline, tidak resmi)`,
        ...lines,
      ].join('\n'),
    };
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'prayer_times',
        description:
          'Get approximate Muslim prayer times offline for a location. Default Tarakan if no coordinates.',
        parameters: {
          type: 'object',
          properties: {
            latitude: {type: 'number'},
            longitude: {type: 'number'},
            city: {type: 'string'},
          },
        },
      },
    };
  }
}
