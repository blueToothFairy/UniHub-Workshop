import 'dotenv/config';
import { AuthService } from './dist/modules/auth/auth.service.js';

(async () => {
  try {
    const svc = new AuthService();
    const result = await svc.register({ email: 'dungd@example.com', full_name: 'dungd', password: 'Password123!' }, '127.0.0.1', 'test-agent');
    console.log('REGISTER RESULT', result);
  } catch (err) {
    console.error('REGISTER ERROR', err);
  }
})();
