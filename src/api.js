import axios from 'axios';

// CSRF token is kept in a module-scoped variable so every axios call can read
// and write it without threading state through components.
let csrfToken = null;

export function getCsrfToken() {
  return csrfToken;
}

export function setCsrfToken(token) {
  if (typeof token === 'string' && token.length > 0) {
    csrfToken = token;
  }
}

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Capture rotating CSRF tokens from every response. Works for success and
// error responses so a 401 on /me still hands us a token for the login POST.
function captureCsrfFromResponse(response) {
  const headerToken =
    response?.headers?.['x-csrf-token'] || response?.headers?.['X-CSRF-Token'];
  if (headerToken) {
    setCsrfToken(headerToken);
  }
  const bodyToken = response?.data?.csrf_token;
  if (bodyToken) {
    setCsrfToken(bodyToken);
  }
}

api.interceptors.response.use(
  (response) => {
    captureCsrfFromResponse(response);
    return response;
  },
  (error) => {
    if (error?.response) {
      captureCsrfFromResponse(error.response);
    }
    return Promise.reject(error);
  },
);

// Attach CSRF header on any state-changing request. GET/HEAD/OPTIONS don't
// need it and the server won't check.
api.interceptors.request.use((config) => {
  const method = (config.method || 'get').toLowerCase();
  if (method !== 'get' && method !== 'head' && method !== 'options' && csrfToken) {
    config.headers = config.headers || {};
    config.headers['X-CSRF-Token'] = csrfToken;
  }
  return config;
});

export function uploadFile(fileId, stage, file) {
  const formData = new FormData();
  formData.append('file_id', fileId);
  formData.append('stage', stage);
  formData.append('file', file);

  return api.post('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

export function getDownloadUrl(fileId, stage) {
  return `/api/upload?file_id=${fileId}&stage=${stage}`;
}

export function getArtifactDownloadUrl(artifactId) {
  return `/api/upload?artifact_id=${artifactId}`;
}

export function extractApiError(err, fallback = 'Something went wrong') {
  const data = err?.response?.data;
  if (data?.message) return data.code ? `${data.message}` : data.message;
  return fallback;
}

export default api;
