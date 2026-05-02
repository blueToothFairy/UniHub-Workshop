(async () => {
  try {
    const res = await fetch('http://localhost:3000/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'dungd@example.com', full_name: 'dungd', password: 'Password123!' })
    });
    console.log('STATUS', res.status);
    const text = await res.text();
    console.log(text);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
