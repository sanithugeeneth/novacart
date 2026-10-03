const $ = s => document.querySelector(s);
const tabs = [...document.querySelectorAll('.tabs button')];
const forms = { signin: $('#signin'), admin: $('#admin'), signup: $('#signup') };
const status = msg => { $('#authStatus').textContent = msg; };

tabs.forEach(t => t.onclick = () => {
  tabs.forEach(x => x.classList.toggle('active', x === t));
  Object.entries(forms).forEach(([key, form]) => form.classList.toggle('hidden', t.dataset.tab !== key));
  tabs.forEach(x => x.setAttribute('aria-selected', String(x === t)));
  const adminMode = t.dataset.tab === 'admin';
  $('#otpWrap')?.classList.toggle('hidden', !adminMode);
  status('');
});

document.querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => {
  const i = $('#' + b.dataset.toggle); i.type = i.type === 'password' ? 'text' : 'password'; b.textContent = i.type === 'password' ? 'Show' : 'Hide';
});

function storeUser(user) { localStorage.setItem('novacart_user', JSON.stringify(user)); }
async function post(url, payload) {
  const r = await fetch(url, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong.');
  return j;
}

$('#signin').onsubmit = async e => {
  e.preventDefault(); status('Signing you in…');
  try {
    const j = await post('/api/auth/login', { email: $('#loginEmail').value.trim(), password: $('#loginPassword').value });
    storeUser(j.user); location.href = '/';
  } catch (err) { status(err.message); }
};


$('#admin').onsubmit = async e => {
  e.preventDefault(); status('Signing you into the control center…');
  try {
    const j = await post('/api/admin/login', {
      email: $('#adminEmail').value.trim(),
      password: $('#adminPassword').value,
      otp: $('#adminOtp')?.value.trim() || ''
    });
    storeUser(j.user);
    location.href = '/admin.html';
  } catch (err) { status(err.message); }
};

$('#signup').onsubmit = async e => {
  e.preventDefault(); status('Creating your account…');
  try {
    const j = await post('/api/auth/register', { name: $('#signupName').value.trim(), email: $('#signupEmail').value.trim(), password: $('#signupPassword').value });
    storeUser(j.user); location.href = '/';
  } catch (err) { status(err.message); }
};

$('#forgot').onclick = async e => {
  e.preventDefault();
  const email = $('#loginEmail').value.trim();
  if (!email) return status('Enter your email first, then click “Forgot password?”.');
  status('Sending reset instructions…');
  try { const j = await post('/api/auth/forgot', { email }); status(j.message); }
  catch (err) { status(err.message); }
};
