import type {
  TalentEngine,
  TalentResult,
  ToolDefinition,
  TalentExecuteContext,
} from './types';

/**
 * Weather talent via free Open-Meteo API (no API key).
 * Network is used only when the model invokes this tool.
 */
export class WeatherEngine implements TalentEngine {
  readonly name = 'weather';

  async execute(
    args: Record<string, any>,
    _ctx?: TalentExecuteContext,
  ): Promise<TalentResult> {
    const city = typeof args.city === 'string' ? args.city.trim() : '';
    if (!city) {
      return {
        type: 'error',
        summary: 'weather: city is required',
        errorMessage: 'city is required',
      };
    }
    try {
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        city,
      )}&count=1&language=en&format=json`;
      const geoRes = await fetch(geoUrl);
      const geo = await geoRes.json();
      const place = geo?.results?.[0];
      if (!place) {
        return {
          type: 'error',
          summary: `weather: city not found (${city})`,
          errorMessage: `City not found: ${city}`,
        };
      }
      const {latitude, longitude, name, country} = place;
      const wxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m`;
      const wxRes = await fetch(wxUrl);
      const wx = await wxRes.json();
      const cur = wx?.current || {};
      const summary = [
        `Weather in ${name}${country ? `, ${country}` : ''}:`,
        `Temperature: ${cur.temperature_2m}°C`,
        `Humidity: ${cur.relative_humidity_2m}%`,
        `Wind: ${cur.wind_speed_10m} km/h`,
        `Weather code: ${cur.weather_code}`,
      ].join('\n');
      return {type: 'text', summary};
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      return {
        type: 'error',
        summary: `weather: ${errMsg}`,
        errorMessage: errMsg,
      };
    }
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'weather',
        description:
          'Get current weather for a city using Open-Meteo (no API key required).',
        parameters: {
          type: 'object',
          properties: {
            city: {
              type: 'string',
              description: 'City name, e.g. "Jakarta" or "Tokyo"',
            },
          },
          required: ['city'],
        },
      },
    };
  }
}
