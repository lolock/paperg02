/**
 * Cloudflare Worker entry point for handling API requests.
 * Intercepts requests made to /api/*
 *
 * Environment variables expected:
 * - OPENAI_API_KEY: Your OpenAI-compatible API key (Secret).
 * - API_ENDPOINT: The BASE URL for the LLM API endpoint (e.g., "https://api.openai.com/v1").
 * - SYSTEM_PROMPT: The system prompt for the LLM.
 * - LLM_MODEL: The model name to use (e.g., "gpt-4", "gpt-3.5-turbo").
 * - KV_NAMESPACE: Binding to the Cloudflare KV namespace (for auth codes & usage).
 */

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
      // Route not found or method not allowed
      console.warn(`No matching route found for ${request.method} ${url.pathname}.`); // Keep warning for unmatched routes
      response = new Response(JSON.stringify({ error: 'API route not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // Ensure we always have a Response object after the handler call
    if (!(response instanceof Response)) {
        console.error("Handler did not return a valid Response object. Assigning 500."); // Keep critical error
        response = new Response(JSON.stringify({ error: 'Internal Server Error: Invalid handler response' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }

  } catch (error) {
    // Catch unexpected errors during request routing or handler execution itself
    console.error('Error during request handling or handler execution:', error); // Keep critical error
    response = new Response(JSON.stringify({ error: 'Internal Server Error', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- Add CORS Headers to the final response ---
  const corsHeaders = {
      'Access-Control-Allow-Origin': '*', // Consider restricting in production
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  const responseHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => {
      responseHeaders.set(key, value);
  });

  // Return the final response
  return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
  });
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
    let body;
    try { body = await request.json(); } catch (e) { return new Response(JSON.stringify({ error: 'Invalid JSON format in request body.'}), { status: 400, headers: { 'Content-Type': 'application/json' } }); }
    const providedCode = body.code;
    if (!providedCode) {
       return new Response(JSON.stringify({ error: 'Login code is required.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // --- KV Validation Logic ---
    if (!env.KV_NAMESPACE) {
        console.error("KV_NAMESPACE binding is not configured in environment."); // Keep critical config error
        return new Response(JSON.stringify({ error: 'Server configuration error: KV Namespace not bound.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const kvValue = await env.KV_NAMESPACE.get(providedCode);

    if (kvValue !== null) { // Key exists
      // console.log(`Successful login attempt with valid KV code: ${providedCode}`); // Optional: Keep if needed for audit
      return new Response(JSON.stringify({ success: true, message: 'Login successful.' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } else { // Key does not exist
      console.warn(`Failed login attempt with non-existent KV code: ${providedCode}`); // Keep warning for failed attempts
      return new Response(JSON.stringify({ success: false, error: 'Invalid login code.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    // --- End of KV Validation ---

  } catch (error) {
    console.error('[handleLoginRequest] Unexpected error caught:', error); // Keep critical error
    return new Response(JSON.stringify({ error: 'Failed to process login request.', details: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}


/**
 * Handles the /api/chat POST request using KV validation and calling LLM API. Cleaned version.
 * @param {Request} request
 * @param {object} env - Environment object
 * @returns {Promise<Response>}
 */
async function handleChatRequest(request, env) {
  try {
    // --- Input Validation ---
    if (!request.headers.get('content-type')?.includes('application/json')) {
        return new Response(JSON.stringify({ error: 'Invalid request body type. Expected JSON.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    let body;
    try {
        body = await request.json();
    } catch (jsonError) {
        console.error('[handleChatRequest] Failed to parse request JSON body:', jsonError); // Keep error
        return new Response(JSON.stringify({ error: 'Invalid JSON format in request body.', details: jsonError.message }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const userMessage = body.message;
    const loginCode = body.code;
    if (!userMessage || !loginCode) {
        return new Response(JSON.stringify({ error: 'Message and login code are required.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // --- Re-validate Login Code using KV ---
    if (!env.KV_NAMESPACE) {
        console.error("[handleChatRequest] KV_NAMESPACE binding is not configured."); // Keep critical config error
        return new Response(JSON.stringify({ error: 'Server configuration error: KV Namespace not bound.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    const kvValue = await env.KV_NAMESPACE.get(loginCode);
    if (kvValue === null) {
        console.warn(`[handleChatRequest] Invalid/non-existent KV code during chat: ${loginCode}`); // Keep warning
        return new Response(JSON.stringify({ error: 'Invalid or expired login code.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    // --- Get Configuration ---
    const apiKey = env.OPENAI_API_KEY;
    const apiBaseUrl = env.API_ENDPOINT || "https://api.openai.com/v1"; // Default base URL
    const systemPrompt = env.SYSTEM_PROMPT || "You are a helpful assistant.";
    const modelName = env.LLM_MODEL || "gpt-3.5-turbo";

    if (!apiKey) {
        console.error("[handleChatRequest] OPENAI_API_KEY environment variable not set."); // Keep critical config error
        return new Response(JSON.stringify({ error: 'Server configuration error: Missing API Key.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    // --- Construct Full URL ---
    let fullApiUrl;
    try {
        let standardizedBaseUrl = apiBaseUrl.endsWith('/') ? apiBaseUrl.slice(0, -1) : apiBaseUrl;
        fullApiUrl = standardizedBaseUrl.endsWith('/v1')
            ? `${standardizedBaseUrl}/chat/completions`
            : `${standardizedBaseUrl}/v1/chat/completions`;
        new URL(fullApiUrl); // Validate URL
    } catch (urlError) {
        console.error(`[handleChatRequest] Invalid API_ENDPOINT format: ${apiBaseUrl}`, urlError); // Keep error
        return new Response(JSON.stringify({ error: 'Server configuration error: Invalid API Endpoint URL format.', details: urlError.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    // --- Prepare Request & Call LLM API ---
    const messages = [ { role: "system", content: systemPrompt }, { role: "user", content: userMessage } ]; // Note: cleanedUserMessage logic removed for simplicity, add back if needed
    const llmRequestPayload = { model: modelName, messages: messages };
    // console.log(`[handleChatRequest] Calling LLM API at ${fullApiUrl}...`); // Optional: Keep for minimal tracing

    const llmResponse = await fetch(fullApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(llmRequestPayload),
    });

    // --- Process LLM Response ---
    if (!llmResponse.ok) { // Handle non-2xx responses
        let errorText = `LLM API returned status ${llmResponse.status}`;
        try {
             const errorBody = await llmResponse.text();
             console.error(`[handleChatRequest] LLM API request failed body: ${errorBody}`); // Keep error log with body
             errorText = errorBody || errorText;
        } catch (e) { console.error("[handleChatRequest] Failed to read LLM error response body:", e); }
        // Return a structured error including details from the LLM API response
        return new Response(JSON.stringify({ error: 'Failed to get response from AI service.', llm_status: llmResponse.status, llm_details: errorText }), {
             status: 500, // Internal Server Error because *our* service couldn't fulfill the request via the upstream API
             headers: { 'Content-Type': 'application/json' }
         });
    }

    // --- Process OK response (2xx) ---
    let llmResult;
    try {
        llmResult = await llmResponse.json();
    } catch (jsonError) {
        console.error('[handleChatRequest] Failed to parse LLM JSON response:', jsonError); // Keep error
        // Attempt to log raw text if JSON parsing fails
        let rawText = "[Could not read raw text after JSON parse failure]";
        try { const responseClone = llmResponse.clone(); rawText = await responseClone.text(); console.error('[handleChatRequest] Raw response text:', rawText); } catch (textError) { /* ignore */ }
        return new Response(JSON.stringify({ error: 'Failed to parse AI response.', details: jsonError.message, raw_response: rawText }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    // --- Extract reply ---
    let aiReply = llmResult.choices?.[0]?.message?.content?.trim();
    // Add fallback for slightly different structures if necessary
     if (!aiReply) {
         aiReply = llmResult.response || llmResult.output || llmResult.text || llmResult.content;
         if (!aiReply && typeof llmResult === 'string') { aiReply = llmResult.trim(); }
     }

    if (!aiReply) {
        console.error('[handleChatRequest] Could not extract AI reply from parsed LLM response:', JSON.stringify(llmResult)); // Keep error
        return new Response(JSON.stringify({ error: 'Failed to parse AI response (content missing).', response_structure: JSON.stringify(llmResult) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    // --- TODO: Token Tracking ---

    // --- Return AI Reply ---
    return new Response(JSON.stringify({ reply: aiReply }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[handleChatRequest] Unexpected error caught in try-catch block:', error); // Keep critical error
    return new Response(JSON.stringify({ error: 'Failed to process chat request.', details: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// --- TODO: Add updateTokenCount function later for KV ---