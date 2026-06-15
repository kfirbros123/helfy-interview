const loginForm = document.getElementById('login-form');
const status = document.getElementById('status');
const output = document.getElementById('output');
const profileActions = document.getElementById('profile-actions');
const profileButton = document.getElementById('profile-button');
const logoutButton = document.getElementById('logout-button');

function setStatus(message, isError = false) {
  status.textContent = message;
  status.style.color = isError ? '#d8000c' : '#007700';
}

function renderOutput(data) {
  output.textContent = JSON.stringify(data, null, 2);
}

function getToken() {
  return localStorage.getItem('helfy_token');
}

function setToken(token) {
  if (token) {
    localStorage.setItem('helfy_token', token);
    profileActions.style.display = 'block';
  } else {
    localStorage.removeItem('helfy_token');
    profileActions.style.display = 'none';
  }
}

async function apiRequest(url, options = {}) {
  const token = getToken();
  const headers = options.headers || {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  headers['Content-Type'] = 'application/json';

  const response = await fetch(url, { ...options, headers });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const loginValue = document.getElementById('loginValue').value.trim();
  const password = document.getElementById('password').value;

  if (!loginValue) {
    setStatus('Enter username or email.', true);
    return;
  }
  if (!password) {
    setStatus('Enter password.', true);
    return;
  }

  try {
    setStatus('Logging in...');
    const response = await apiRequest('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: loginValue, email: loginValue, password }),
    });
    setToken(response.token);
    setStatus('Login successful. Token stored in localStorage.');
    renderOutput(response);
  } catch (error) {
    setStatus(error.message, true);
    renderOutput({ error: error.message });
  }
});

profileButton.addEventListener('click', async () => {
  try {
    setStatus('Fetching profile...');
    const response = await apiRequest('/api/profile', { method: 'GET' });
    setStatus('Profile loaded.');
    renderOutput(response);
  } catch (error) {
    setStatus(error.message, true);
    renderOutput({ error: error.message });
  }
});

logoutButton.addEventListener('click', async () => {
  try {
    await apiRequest('/api/logout', { method: 'POST' });
    setToken(null);
    setStatus('Logged out.');
    renderOutput({ success: true });
  } catch (error) {
    setStatus(error.message, true);
    renderOutput({ error: error.message });
  }
});

if (getToken()) {
  profileActions.style.display = 'block';
}
