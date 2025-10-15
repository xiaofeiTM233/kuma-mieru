import { apiConfig } from '@/config/api';
import type { GlobalConfig, Maintenance } from '@/types/config';
import { ConfigError } from '@/utils/errors';
import { extractPreloadData } from '@/utils/json-processor';
import { sanitizeJsonString } from '@/utils/json-sanitizer';
import { fetchPreloadDataFromApi, getPreloadPayload } from '@/utils/preload-data';
import * as cheerio from 'cheerio';
import { cache } from 'react';
import { ApiDataError, logApiError } from './utils/api-service';
import { customFetchOptions, ensureUTCTimezone } from './utils/common';
import { customFetch } from './utils/fetch';

function processMaintenanceData(maintenanceList: Maintenance[]): Maintenance[] {
  return maintenanceList.map((maintenance) => {
    const processed = {
      ...maintenance,
    };

    if (maintenance.timeslotList && maintenance.timeslotList.length > 0) {
      processed.timeslotList = maintenance.timeslotList.map((slot) => ({
        startDate: ensureUTCTimezone(slot.startDate),
        endDate: ensureUTCTimezone(slot.endDate),
      }));
    }

    const now = Date.now();

    if (processed.timeslotList && processed.timeslotList.length > 0) {
      const { startDate, endDate } = processed.timeslotList[0];
      const startTime = new Date(startDate).getTime();
      const endTime = new Date(endDate).getTime();

      if (now >= startTime && now < endTime) {
        processed.status = 'under-maintenance';
      } else if (now < startTime) {
        processed.status = 'scheduled';
      } else if (now >= endTime) {
        processed.status = 'ended';
      }
    }

    return processed;
  });
}

/**
 * 获取维护计划数据
 * @returns 处理后的维护计划数据
 */
export async function getMaintenanceData() {
  try {
    const preloadData = await getPreloadData();

    if (!Array.isArray(preloadData.maintenanceList)) {
      throw new ApiDataError('Maintenance list data must be an array');
    }

    const maintenanceList = preloadData.maintenanceList;
    const processedList = processMaintenanceData(maintenanceList);

    return {
      success: true,
      maintenanceList: processedList,
    };
  } catch (error) {
    logApiError('get maintenance data', error, {
      endpoint: `${apiConfig.apiEndpoint}/maintenance`,
    });

    return {
      success: false,
      maintenanceList: [],
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

export const getGlobalConfig = cache(async (): Promise<GlobalConfig> => {
  try {
    const preloadData = await getPreloadData();

    if (!preloadData.config) {
      throw new ConfigError('Configuration data is missing');
    }

    const requiredFields = ['slug', 'title', 'description', 'icon', 'theme'];

    for (const field of requiredFields) {
      if (!(field in preloadData.config)) {
        throw new ConfigError(`Configuration is missing required field: ${field}`);
      }
    }

    if (typeof preloadData.config.theme !== 'string') {
      throw new ConfigError('Theme must be a string');
    }

    const theme =
      preloadData.config.theme === 'dark'
        ? 'dark'
        : preloadData.config.theme === 'light'
          ? 'light'
          : 'system';

    const maintenanceData = await getMaintenanceData();
    const maintenanceList = maintenanceData.maintenanceList || [];

    const config: GlobalConfig = {
      config: {
        ...preloadData.config,
        theme,
      },
      incident: preloadData.incident
        ? {
            ...preloadData.incident,
            createdDate: ensureUTCTimezone(preloadData.incident.createdDate),
            lastUpdatedDate: ensureUTCTimezone(preloadData.incident.lastUpdatedDate),
          }
        : undefined,
      maintenanceList: maintenanceList,
    };

    return config;
  } catch (error) {
    console.error(
      'Failed to get configuration data:',
      error instanceof ConfigError ? error.message : 'Unknown error',
      error,
    );

    return {
      config: {
        slug: '',
        title: '',
        description: '',
        icon: '/icon.svg',
        theme: 'system',
        published: true,
        showTags: true,
        customCSS: '',
        footerText: '',
        showPoweredBy: false,
        googleAnalyticsId: null,
        showCertificateExpiry: false,
      },
      maintenanceList: [],
    };
  }
});

export async function getPreloadData() {
  try {
    const htmlResponse = await customFetch(apiConfig.htmlEndpoint, customFetchOptions);

    if (!htmlResponse.ok) {
      throw new ConfigError(
        `Failed to get HTML: ${htmlResponse.status} ${htmlResponse.statusText}`,
      );
    }

    const html = await htmlResponse.text();
    const $ = cheerio.load(html);
    
    // Uptime Kuma version > 1.18.4, use script#preload-data to get preload data
    // @see https://github.com/louislam/uptime-kuma/commit/6e07ed20816969bfd1c6c06eb518171938312782
    // & https://github.com/louislam/uptime-kuma/issues/2186#issuecomment-1270471470
    const { payload: initialPayload, source } = getPreloadPayload($);
    let preloadScript = initialPayload ?? '';

    if (source === 'data-json') {
      console.debug('Using preload data from data-json attribute');
    }

    if (!preloadScript || preloadScript.trim() === '') {
      // Uptime Kuma version <= 1.18.4, use script:contains("window.preloadData") to get preload data
      const scriptWithPreloadData = $('script:contains("window.preloadData")').text();

      if (scriptWithPreloadData) {
        const match = scriptWithPreloadData.match(/window\.preloadData\s*=\s*({[\s\S]*?});/);
        if (match && match[1]) {
          preloadScript = match[1];
          console.log('Successfully extracted preload data from window.preloadData');
        } else {
          console.error('Failed to extract preload data with regex. Script content:', scriptWithPreloadData.slice(0, 200));
        }
      }
    }

    if (!preloadScript || preloadScript.trim() === '') {
      console.warn('Preload script missing, attempting status page API fallback');
      try {
        const apiFallback = await fetchPreloadDataFromApi({
          baseUrl: apiConfig.baseUrl,
          pageId: apiConfig.pageId,
          fetchFn: (url, init) =>
            customFetch(url, init as RequestInit & { maxRetries?: number; retryDelay?: number; timeout?: number }),
          requestInit: customFetchOptions,
        });
        console.info('Using status page API fallback for preload data');
        return apiFallback.data;
      } catch (apiError) {
        console.error('Status page API fallback failed:', apiError);
      }
    }

    if (!preloadScript || preloadScript.trim() === '') {
      console.error('HTML response preview:', html.slice(0, 500));
      console.error('Available script tags:', $('script').map((i, el) => $(el).attr('id') || 'no-id').get());
      throw new ConfigError('Preload script tag not found or empty');
    }

    try {
      const jsonStr = sanitizeJsonString(preloadScript);
      return extractPreloadData(jsonStr);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ConfigError(
          `JSON parsing failed: ${error.message}\nProcessed data: ${preloadScript.slice(0, 100)}...`,
          error,
        );
      }
      if (error instanceof ConfigError) {
        throw error;
      }
      throw new ConfigError(
        `Failed to parse preload data: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error,
      );
    }
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    console.error('Failed to get preload data:', {
      endpoint: apiConfig.htmlEndpoint,
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack,
              cause: error.cause,
            }
          : error,
    });
    throw new ConfigError(
      'Failed to get preload data, please check network connection and server status',
    );
  }
}
