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

  // --- Request Routing ---
  try {
    // Handle CORS preflight requests (OPTIONS)
    if (request.method === 'OPTIONS') {
        return handleOptions();
    }

    // Define standard CORS headers
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    let response; // Variable to hold the response

    // Route requests
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

    // Add CORS headers to the response
    const responseHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => {
        responseHeaders.set(key, value);
    });

    // Return response with updated headers
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
    });

  } catch (error) {
    // Catch unexpected errors
    console.error('Error handling request:', error);
    const errorResponse = new Response(JSON.stringify({ error: 'Internal Server Error', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
     errorResponse.headers.set('Access-Control-Allow-Origin', '*');
    return errorResponse;
  }
}

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
 * @param {Request} request
 * @param {object} env - Contains KV_NAMESPACE binding
 * @returns {Promise<Response>}
 */
async function handleLoginRequest(request, env) {
  try {
    // Validate request
    if (!request.headers.get('content-type')?.includes('application/json')) {
      return new Response(JSON.stringify({ error: 'Invalid request body type. Expected JSON.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const body = await request.json();
    const providedCode = body.code;
    if (!providedCode) {
      return new Response(JSON.stringify({ error: 'Login code is required.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // --- KV Validation Logic ---
    if (!env.KV_NAMESPACE) {
        console.error("KV_NAMESPACE binding is not configured in environment.");
        return new Response(JSON.stringify({ error: 'Server configuration error: KV Namespace not bound.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    // Check if the provided code exists as a key in KV
    console.log(`Checking KV for login code: ${providedCode}`); // Log check
    const kvValue = await env.KV_NAMESPACE.get(providedCode);
    console.log(`KV lookup for ${providedCode} returned: ${kvValue === null ? 'null (Not Found)' : 'Found'}`); // Log result

    if (kvValue !== null) { // Key exists
      console.log(`Successful login attempt with valid KV code: ${providedCode}`);
      return new Response(JSON.stringify({ success: true, message: 'Login successful.' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } else { // Key does not exist
      console.warn(`Failed login attempt with non-existent KV code: ${providedCode}`);
      return new Response(JSON.stringify({ success: false, error: 'Invalid login code.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    // --- End of KV Validation ---

  } catch (error) {
    console.error('Error in handleLoginRequest:', error);
     if (error instanceof SyntaxError) {
        return new Response(JSON.stringify({ error: 'Invalid JSON format in request body.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'Failed to process login request.', details: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handles the /api/chat POST request using KV validation and calling LLM API.
 * @param {Request} request
 * @param {object} env - Environment object
 * @returns {Promise<Response>}
 */
async function handleChatRequest(request, env) {
  try {
    // --- Input Validation ---
    if (!request.headers.get('content-type')?.includes('application/json')) { /* ... */ }
    const body = await request.json();
    const userMessage = body.message;
    const loginCode = body.code;
    if (!userMessage || !loginCode) { /* ... */ }

    // --- Re-validate Login Code using KV ---
    if (!env.KV_NAMESPACE) { /* ... return 500 ... */ }
    console.log(`Checking KV for chat request with code: ${loginCode}`); // Log check
    const kvValue = await env.KV_NAMESPACE.get(loginCode);
     console.log(`KV lookup for ${loginCode} (chat) returned: ${kvValue === null ? 'null (Not Found)' : 'Found'}`); // Log result
    if (kvValue === null) {
        console.warn(`Chat attempt with invalid/non-existent KV code: ${loginCode}`);
        return new Response(JSON.stringify({ error: 'Invalid or expired login code.' }), { status: 401, /* ... */ });
    }
    // --- End of KV Validation ---

    // --- Get Configuration ---
    const apiKey = env.OPENAI_API_KEY;
    const apiEndpoint = env.API_ENDPOINT || "https://api.openai.com/v1/chat/completions";
    const systemPrompt = env.SYSTEM_PROMPT || "You are a helpful assistant.";
    const modelName = env.LLM_MODEL || "gpt-3.5-turbo";
    if (!apiKey) { /* ... return 500 ... */ }

    // --- Prepare & Call LLM API ---
    const messages = [ { role: "system", content: systemPrompt }, { role: "user", content: userMessage } ];
    const llmRequestPayload = { model: modelName, messages: messages };
    console.log(`Calling LLM API at ${apiEndpoint} using model ${modelName} for code ${loginCode}`);
    const llmResponse = await fetch(apiEndpoint, { /* ... options ... */ });

    // --- Process LLM Response ---
    if (!llmResponse.ok) { /* ... handle LLM error ... */ }
    const llmResult = await llmResponse.json();
    const aiReply = llmResult.choices?.[0]?.message?.content?.trim();
    if (!aiReply) { /* ... handle parsing error ... */ }
    console.log(`Received AI reply using ${modelName} for code ${loginCode}: "${aiReply.substring(0, 50)}..."`);

    // --- TODO: Token Tracking ---

    // --- Return AI Reply ---
    return new Response(JSON.stringify({ reply: aiReply }), { status: 200, /* ... */ });

  } catch (error) { /* ... handle errors ... */ }
}

// --- TODO: Add updateTokenCount function later ---
