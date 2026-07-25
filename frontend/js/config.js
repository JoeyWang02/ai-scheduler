// No build step: pick the backend origin at runtime based on where the frontend is served from.
// In production the Spring Boot backend serves this frontend from its own origin
// (single service — see Dockerfile), so the API is reached with same-origin
// relative URLs. Locally the frontend runs on :8099 and the API on :8081.
export const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:8081'
    : '';
