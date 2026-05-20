const http = require('http');

async function run() {
  // 1. Login as Ops
  const resLogin = await fetch('http://localhost:4000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ops@cevop.io', password: 'Super1234!' }),
  });
  const loginData = await resLogin.json();
  if (!loginData.success) {
    console.error('Ops login failed', loginData);
    return;
  }

  const opsToken = loginData.data.accessToken;
  console.log('Ops logged in');

  // 2. Fetch an organization
  const resOrgs = await fetch('http://localhost:4000/api/ops/activity', {
    headers: { Authorization: `Bearer ${opsToken}` },
  });
  const orgsData = await resOrgs.json();
  const targetOrg = orgsData.data.recentOrgs[0];
  if (!targetOrg) {
    console.error('No org found');
    return;
  }

  console.log('Target Org:', targetOrg.name);

  // 3. Impersonate
  const resImp = await fetch(`http://localhost:4000/api/ops/orgs/${targetOrg.id}/impersonate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opsToken}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const impData = await resImp.json();
  if (!impData.success) {
    console.error('Impersonate failed', impData);
    return;
  }

  const impToken = impData.data.token;
  console.log('Impersonation token acquired');

  // 4. Fetch /me
  const resMe = await fetch('http://localhost:4000/api/auth/me', {
    headers: { Authorization: `Bearer ${impToken}` },
  });
  const meData = await resMe.json();
  console.log('/me response:', JSON.stringify(meData, null, 2));
}

run();
