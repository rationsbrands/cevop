const jwt = require('jsonwebtoken');
require('dotenv').config({ path: 'server/.env' });

const payload = {
  userId: 'test',
  organizationId: 'test-org',
  role: 'ADMIN',
  impersonating: true,
};
const secret = process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET || 'test';
const token = jwt.sign(payload, secret, { expiresIn: '2h' });
console.log(token);
