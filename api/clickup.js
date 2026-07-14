// Serverless proxy: the browser calls /api/clickup?op=... and this function
// talks to the ClickUp REST API server-side, so the token is never exposed.
// Runs on Vercel (Node 18+, global fetch available).
module.exports = async (req, res) => {
  const token = process.env.CLICKUP_API_TOKEN;
  const listId = process.env.CLICKUP_LIST_ID;
  if (!token || !listId) {
    res.status(500).json({ error: 'Missing CLICKUP_API_TOKEN or CLICKUP_LIST_ID env var' });
    return;
  }
  const base = 'https://api.clickup.com/api/v2';
  const headers = { Authorization: token };
  const op = (req.query && req.query.op) || '';
  try {
    let url;
    if (op === 'tasks') {
      const page = parseInt((req.query.page || '0'), 10) || 0;
      url = `${base}/list/${listId}/task?subtasks=true&include_closed=true&page=${page}`;
    } else if (op === 'fields') {
      url = `${base}/list/${listId}/field`;
    } else if (op === 'statuses' || op === 'list') {
      url = `${base}/list/${listId}`;
    } else if (op === 'task') {
      url = `${base}/task/${encodeURIComponent(req.query.id || '')}`;
    } else {
      res.status(400).json({ error: 'unknown op' });
      return;
    }
    const r = await fetch(url, { headers });
    if (!r.ok) { res.status(r.status).json({ error: 'ClickUp API ' + r.status, detail: await r.text() }); return; }
    const data = await r.json();
    // short browser cache to smooth reloads / rate limits
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
    if (op === 'fields') return res.status(200).json({ fields: data.fields || [] });
    if (op === 'statuses' || op === 'list') return res.status(200).json({ statuses: data.statuses || [] });
    if (op === 'tasks') return res.status(200).json({ tasks: data.tasks || [], last_page: !!data.last_page });
    return res.status(200).json({ task: data });
  } catch (e) {
    res.status(502).json({ error: String((e && e.message) || e) });
  }
};
