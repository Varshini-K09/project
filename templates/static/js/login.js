const API = '/api';

window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('signedout') === '1') {
    document.getElementById('signoutBanner').classList.add('show');
    history.replaceState(null, '', window.location.pathname);
  }
});

document.getElementById('pwToggle').addEventListener('click', function () {
  const pw = document.getElementById('password');
  const isHidden = pw.type === 'password';
  pw.type = isHidden ? 'text' : 'password';
  this.textContent = isHidden ? 'Hide' : 'Show';
});

document.addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });

function showError(msg) {
  const b = document.getElementById('errorBox');
  b.textContent = msg;
  b.classList.add('show');
}

async function handleLogin() {
  const email    = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const btn      = document.getElementById('signinBtn');

  document.getElementById('errorBox').classList.remove('show');
  document.getElementById('signoutBanner').classList.remove('show');

  if (!email || !password) { showError('Please enter your email and password.'); return; }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Signing in…';

  try {
    const res = await fetch(`${API}/auth/login/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emp_email: email, password })
    });
    const data = await res.json();

    if (!res.ok) { showError(data.detail || 'Sign in failed. Please try again.'); return; }

    localStorage.setItem('access',   data.access);
    localStorage.setItem('refresh',  data.refresh);
    localStorage.setItem('employee', JSON.stringify(data.employee));
    window.location.href = '/api/dashboard/';
  } catch {
    showError('Unable to connect. Please check your network.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Sign in';
  }
}

function logout() {
  localStorage.clear();
  sessionStorage.clear();
  window.location.href = '/api/login-page/?signedout=1';
}