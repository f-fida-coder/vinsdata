import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
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

export default api;
