/**
 * API utilities and configuration
 */

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

/**
 * Get API endpoint URL
 */
export const getApiUrl = (endpoint: string): string => {
  return `${API_BASE_URL}${endpoint}`;
};

/**
 * Create fetch options with default headers
 */
export const createFetchOptions = (method: string = 'GET', body?: any): RequestInit => {
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  return options;
};

/**
 * Handle API errors consistently
 */
export const handleApiError = async (response: Response): Promise<never> => {
  const errorData = await response.json().catch(() => ({ message: 'Failed to fetch data' }));
  throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
};

/**
 * Make API request with error handling
 */
export const apiRequest = async (endpoint: string, options?: RequestInit): Promise<any> => {
  const response = await fetch(getApiUrl(endpoint), options);
  
  if (!response.ok) {
    await handleApiError(response);
  }

  return response.json();
};