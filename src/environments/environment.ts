import { Environment } from './environment.interface';

export const environment: Environment = {
  production: false,
  apiUrl: 'http://localhost:9999/.netlify/functions',
  googleClientId: '269149129834-futdaq5b6ofpefjoqbofr4rqmh7l20l8.apps.googleusercontent.com',
  googleRedirectUri: 'http://localhost:4200/oauth-callback'
};
