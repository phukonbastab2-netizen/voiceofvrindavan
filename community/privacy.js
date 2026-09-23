document.getElementById('withdraw-permission').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const status = document.getElementById('withdraw-status');
  button.disabled = true;
  status.textContent = 'Updating your permission…';
  try {
    const response = await fetch('/api/community/profile', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ datasetConsent: false, trainingConsent: false })
    });
    if (response.status === 401) throw new Error('Please sign in to the conversation room, then return here to withdraw permission.');
    if (!response.ok) throw new Error('Could not update your permission. Please try again.');
    status.textContent = 'Dataset and AI-training permission withdrawn. Your conversations are no longer eligible for future exports. Existing managed copies update after the next successful refresh.';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
