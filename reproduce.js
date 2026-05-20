const http = require('http');

async function run() {
  const resLogin = await fetch('http://localhost:4000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ops@cevop.io', password: 'Password123!' }), // Ops new password
  });
  const loginData = await resLogin.json();
  if (!loginData.success) {
    console.error('Login failed:', loginData);
    return;
  }
  const cookies = resLogin.headers.get('set-cookie');
  const opsToken = loginData.data.accessToken;

  const resOrgs = await fetch('http://localhost:4000/api/ops/activity', {
    headers: { Authorization: `Bearer ${opsToken}` },
  });
  const orgsData = await resOrgs.json();
  const targetOrg = orgsData.data.recentOrgs[0];

  const resLogout = await fetch('http://localhost:4000/api/auth/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookies },
  });
  console.log('Logout status:', resLogout.status);

  const resImp2 = await fetch(`http://localhost:4000/api/ops/orgs/${targetOrg.id}/impersonate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opsToken}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const impData2 = await resImp2.json();
  console.log('Impersonate 2 success:', impData2.success);

  const resMe = await fetch('http://localhost:4000/api/auth/me', {
    headers: { Authorization: `Bearer ${impData2.data.token}` },
  });
  const meData = await resMe.json();
  console.log('/me after logout:', JSON.stringify(meData, null, 2));
}

run();
