// Check if we need to show setup form
async function checkSetupStatus() {
    try {
        const response = await fetch('/auth/needs-setup', {
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.needsSetup) {
                console.log('No users found, showing setup form');
                showSetupForm();
                return true;
            }
        }
        return false;
    } catch (error) {
        console.error('Setup check error:', error);
        return false;
    }
}

// Login Form Handler
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorDiv = document.getElementById('loginError');
    const submitBtn = document.getElementById('loginBtn');
    const btnText = submitBtn.querySelector('.btn-text');
    const btnLoading = submitBtn.querySelector('.btn-loading');
    
    // Clear previous errors
    errorDiv.classList.remove('show');
    errorDiv.textContent = '';
    
    // Show loading state
    submitBtn.disabled = true;
    btnText.style.display = 'none';
    btnLoading.style.display = 'inline';
    
    try {
        const response = await fetch('/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ email, password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Successful login
            window.location.href = '/index.html';
        } else {
            // Show error message
            if (response.status === 401 && data.message.includes('Invalid')) {
                errorDiv.textContent = '❌ Invalid email or password';
            } else if (data.message.includes('no users') || data.message.includes('No users')) {
                // No users exist, show setup form
                showSetupForm();
                return;
            } else {
                errorDiv.textContent = '❌ ' + data.message;
            }
            errorDiv.classList.add('show');
        }
    } catch (error) {
        console.error('Login error:', error);
        errorDiv.textContent = '❌ Connection error. Please try again.';
        errorDiv.classList.add('show');
        
        // Check if we need to show setup
        if (error.message.includes('no users')) {
            showSetupForm();
        }
    } finally {
        // Reset button state
        submitBtn.disabled = false;
        btnText.style.display = 'inline';
        btnLoading.style.display = 'none';
    }
});

// Setup Form Handler
document.getElementById('setupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('setupName').value;
    const email = document.getElementById('setupEmail').value;
    const password = document.getElementById('setupPassword').value;
    const passwordConfirm = document.getElementById('setupPasswordConfirm').value;
    const errorDiv = document.getElementById('setupError');
    const submitBtn = document.getElementById('setupBtn');
    const btnText = submitBtn.querySelector('.btn-text');
    const btnLoading = submitBtn.querySelector('.btn-loading');
    
    // Clear previous errors
    errorDiv.classList.remove('show');
    errorDiv.textContent = '';
    
    // Validate passwords match
    if (password !== passwordConfirm) {
        errorDiv.textContent = '❌ Passwords do not match';
        errorDiv.classList.add('show');
        return;
    }
    
    if (password.length < 6) {
        errorDiv.textContent = '❌ Password must be at least 6 characters';
        errorDiv.classList.add('show');
        return;
    }
    
    // Show loading state
    submitBtn.disabled = true;
    btnText.style.display = 'none';
    btnLoading.style.display = 'inline';
    
    try {
        const response = await fetch('/admin/init', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ name, email, password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Show success and switch back to login
            alert('✅ Admin account created! Please log in.');
            showLoginForm();
            
            // Pre-fill email
            document.getElementById('email').value = email;
        } else {
            errorDiv.textContent = '❌ ' + data.message;
            errorDiv.classList.add('show');
        }
    } catch (error) {
        console.error('Setup error:', error);
        errorDiv.textContent = '❌ Connection error. Please try again.';
        errorDiv.classList.add('show');
    } finally {
        // Reset button state
        submitBtn.disabled = false;
        btnText.style.display = 'inline';
        btnLoading.style.display = 'none';
    }
});

// Back to Login Button
document.getElementById('backToLoginBtn').addEventListener('click', () => {
    showLoginForm();
});

function showSetupForm() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('setupForm').style.display = 'block';
    document.getElementById('backToLoginBtn').style.display = 'block';
    document.querySelector('h1').textContent = 'First Time Setup';
    document.querySelector('.subtitle').textContent = 'Create your admin account';
}

function showLoginForm() {
    document.getElementById('setupForm').style.display = 'none';
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('backToLoginBtn').style.display = 'none';
    document.querySelector('h1').textContent = 'NurseMind';
    document.querySelector('.subtitle').textContent = 'Sign in to continue';
    
    // Clear setup form
    document.getElementById('setupForm').reset();
    document.getElementById('setupError').classList.remove('show');
}

// Check auth status and setup status on page load
window.addEventListener('load', async () => {
    try {
        // First check if user is already authenticated
        const authResponse = await fetch('/auth/status', {
            credentials: 'include'
        });
        
        const authData = await authResponse.json();
        
        if (authData.authenticated) {
            window.location.href = '/index.html';
            return;
        }
        
        // Check if setup is needed
        await checkSetupStatus();
    } catch (error) {
        console.error('Auth check error:', error);
        // Still check if setup is needed even if auth check fails
        await checkSetupStatus();
    }
});

// Try login with Enter key
document.querySelectorAll('input').forEach(input => {
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const form = input.closest('form');
            if (form) {
                form.dispatchEvent(new Event('submit'));
            }
        }
    });
});
