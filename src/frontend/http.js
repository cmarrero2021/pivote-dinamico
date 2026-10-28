// src/frontend/http.js
// Injectable HTTP client shared by the pivot store and the admin UI.
// The host app must call configurePivotApi() once (e.g. in a Quasar boot file):

//   import { configurePivotApi } from 'dash-pivot/frontend';
//   import { api } from 'boot/axios';
//   configurePivotApi(api, { basePath: '/api/pivot' });

let _api = null;
let _basePath = '/api/pivot';

export function configurePivotApi(api, { basePath } = {}) {
  _api = api;
  if (basePath) _basePath = basePath;
}

export function getHttp() {
  if (!_api) {
    throw new Error('dash-pivot: HTTP client not configured. Call configurePivotApi(api) before using the package.');
  }
  return _api;
}

export function getBasePath() {
  return _basePath;
}
