import { Environment } from './environment.interface';

export const environment: Environment = {
  production: false,
  apiUrl: 'http://localhost:9999/.netlify/functions',
  googleClientId: '',
  googleRedirectUri: 'http://localhost:4200/oauth-callback'
};
