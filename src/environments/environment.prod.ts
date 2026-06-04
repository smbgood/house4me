import { Environment } from './environment.interface';

export const environment: Environment = {
  production: true,
  apiUrl: 'https://house4me.netlify.app/.netlify/functions',
  googleClientId: '',
  googleRedirectUri: 'https://house4me.netlify.app/oauth-callback'
};
