import { useEffect, useState } from 'react';
import { api } from './api-client.js';

export interface FeatureFlags {
  autosyncOnLogin: boolean;
  thumbs: boolean;
  recommendations: boolean;
  steamRatings: boolean;
}

export interface ConfigResponse {
  flags: FeatureFlags;
}

const DEFAULT_FLAGS: FeatureFlags = {
  autosyncOnLogin: false,
  thumbs: false,
  recommendations: false,
  steamRatings: false,
};

let cachedConfig: ConfigResponse | null = null;
let inFlight: Promise<ConfigResponse> | null = null;

export function useConfig(): { flags: FeatureFlags; loading: boolean } {
  const [config, setConfig] = useState<ConfigResponse | null>(cachedConfig);
  const [loading, setLoading] = useState<boolean>(cachedConfig === null);

  useEffect(() => {
    if (cachedConfig) {
      setConfig(cachedConfig);
      setLoading(false);
      return;
    }
    if (!inFlight) {
      inFlight = api.get<ConfigResponse>('/api/config');
    }
    inFlight
      .then((c) => {
        cachedConfig = c;
        setConfig(c);
        setLoading(false);
      })
      .catch(() => {
        cachedConfig = { flags: DEFAULT_FLAGS };
        setConfig(cachedConfig);
        setLoading(false);
      });
  }, []);

  return { flags: config?.flags ?? DEFAULT_FLAGS, loading };
}
