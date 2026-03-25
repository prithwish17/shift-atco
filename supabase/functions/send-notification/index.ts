import { notifyUsers } from '../_shared/notify.ts'

Deno.serve(async (req) => {
  try {
    const { user_ids, title, body, url, category, metadata } = await req.json()

    if (!Array.isArray(user_ids) || !user_ids.length || !title) {
      return new Response(
        JSON.stringify({ error: 'user_ids (array) and title are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const result = await notifyUsers({
      user_ids,
      title,
      body: body || '',
      url,
      category: category || 'general',
      metadata,
    })

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[send-notification]', err)
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
})
