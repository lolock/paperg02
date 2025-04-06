/**
 * Cloudflare Worker entry point for handling API requests.
 * Intercepts requests made to /api/*
 *
 * Environment variables expected:
 * - OPENAI_API_KEY: Your OpenAI-compatible API key (Secret).
 * - API_ENDPOINT: The URL for the LLM API endpoint.
 * - SYSTEM_PROMPT: The system prompt for the LLM.
 * - LLM_MODEL: The model name to use (e.g., "gpt-4", "gpt-3.5-turbo").
 * - KV_NAMESPACE: Binding to the Cloudflare KV namespace (for auth codes & usage).
 */

// NO Hardcoded valid login code here! Validation uses KV.

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Only respond to requests starting with /api/
  if (!url.pathname.startsWith('/api/')) {
    return new Response('Not Found', { status: 404 });
  }

  // Handle CORS preflight requests first
  if (request.method === 'OPTIONS') {
    return handleOptions();
  }

  let response; // Variable to hold the eventual response object

  try {
    // --- Request Routing ---
    if (url.pathname === '/api/login' && request.method === 'POST') {
      response = await handleLoginRequest(request, env);
    } else if (url.pathname === '/api/chat' && request.method === 'POST') {
      response = await handleChatRequest(request, env);
    } else {
      // Route not found
      response = new Response(JSON.stringify({ error: 'API route not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // Ensure we always have a Response object here, even if handlers failed unexpectedly
    if (!(response instanceof Response)) {
        console.error("Handler did not return a valid Response object. Returning 500.");
        response = new Response(JSON.stringify({ error: 'Internal Server Error: Invalid handler response' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }

  } catch (error) {
    // Catch unexpected errors during request routing or handler execution
    console.error('Error during request handling or handler execution:', error);
    response = new Response(JSON.stringify({ error: 'Internal Server Error', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- Add CORS Headers to the final response ---
  // Define standard CORS headers
  const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  // Create mutable headers from the response
  const responseHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => {
      responseHeaders.set(key, value);
  });

  // Return the response with potentially modified headers
  // Use response.body, response.status etc. to construct the final response
  return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders // Use the modified headers
  });
}

// --- handleOptions, handleLoginRequest, handleChatRequest functions remain the same as V4 ---
// (Make sure the rest of your file still contains the correct V4 versions of these functions)

/**
 * Handles CORS preflight requests (OPTIONS).
 */
function handleOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Max-Age': '86400',
        },
    });
}


/**
 * Handles the /api/login POST request using KV validation.
 * (Code is the same as V4)
 * @param {Request} request
 * @param {object} env - Contains KV_NAMESPACE binding
 * @returns {Promise<Response>}
 */
async function handleLoginRequest(request, env) {
  try {
    if (!request.headers.get('content-type')?.includes('application/json')) { /* ... */ }
    const body = await request.json();
    const providedCode = body.code;
    if (!providedCode) { /* ... */ }

    if (!env.KV_NAMESPACE) { /* ... return 500 ... */ }

    console.log(`Checking KV for login code: ${providedCode}`);
    const kvValue = await env.KV_NAMESPACE.get(providedCode);
    console.log(`KV lookup for ${providedCode} returned: ${kvValue === null ? 'null (Not Found)' : 'Found'}`);

    if (kvValue !== null) {
      console.log(`Successful login attempt with valid KV code: ${providedCode}`);
      return new Response(JSON.stringify({ success: true, message: 'Login successful.' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } else {
      console.warn(`Failed login attempt with non-existent KV code: ${providedCode}`);
      return new Response(JSON.stringify({ success: false, error: 'Invalid login code.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
  } catch (error) { /* ... Error handling ... */ }
}

/**
 * Handles the /api/chat POST request using KV validation and calling LLM API.
 * (Code is the same as V4)
 * @param {Request} request
 * @param {object} env - Environment object
 * @returns {Promise<Response>}
 */
async function handleChatRequest(request, env) {
  try {
    if (!request.headers.get('content-type')?.includes('application/json')) { /* ... */ }
    const body = await request.json();
    const userMessage = body.message;
    const loginCode = body.code;
    if (!userMessage || !loginCode) { /* ... */ }

    if (!env.KV_NAMESPACE) { /* ... return 500 ... */ }
    console.log(`Checking KV for chat request with code: ${loginCode}`);
    const kvValue = await env.KV_NAMESPACE.get(loginCode);
    console.log(`KV lookup for ${loginCode} (chat) returned: ${kvValue === null ? 'null (Not Found)' : 'Found'}`);
    if (kvValue === null) { /* ... return 401 ... */ }

    const apiKey = env.OPENAI_API_KEY;
    const apiEndpoint = env.API_ENDPOINT || "https://api.openai.com/v1/chat/completions";
    const systemPrompt = env.SYSTEM_PROMPT || "You are a helpful assistant.";
    const modelName = env.LLM_MODEL || "gpt-3.5-turbo";
    if (!apiKey) { /* ... return 500 ... */ }

    const messages = [ { role: "system", content: systemPrompt }, { role: "user", content: userMessage } ];
    const llmRequestPayload = { model: modelName, messages: messages };
    console.log(`Calling LLM API at ${apiEndpoint} using model ${modelName} for code ${loginCode}`);
    const llmResponse = await fetch(apiEndpoint, { /* ... options ... */ });

    if (!llmResponse.ok) { /* ... handle LLM error ... */ }
    const llmResult = await llmResponse.json();
    const aiReply = llmResult.choices?.[0]?.message?.content?.trim();
    if (!aiReply) { /* ... handle parsing error ... */ }
    console.log(`Received AI reply using ${modelName} for code ${loginCode}: "${aiReply.substring(0, 50)}..."`);

    // --- TODO: Token Tracking ---

    return new Response(JSON.stringify({ reply: aiReply }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) { /* ... handle errors ... */ }
}