export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Health check endpoint
    if (url.pathname === '/api/health') {
      return Response.json({
        status: 'ok',
        timestamp: Date.now(),
        database: await checkD1Health(env.DB),
        kv: await checkKVHealth(env.KV)
      });
    }
    
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
};

async function checkD1Health(db) {
  try {
    const result = await db.prepare('SELECT 1 as test').first();
    return result?.test === 1 ? 'connected' : 'error';
  } catch (e) {
    return 'error';
  }
}

async function checkKVHealth(kv) {
  try {
    await kv.put('health_check', Date.now().toString(), { expirationTtl: 60 });
    const value = await kv.get('health_check');
    return value ? 'connected' : 'error';
  } catch (e) {
    return 'error';
  }
}
